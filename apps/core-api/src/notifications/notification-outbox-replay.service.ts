import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationOutboxStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDACTED_APPROVAL_LINK } from './notification-body-redaction.js';
import { NotificationCloudTasksService } from './notification-cloud-tasks.service.js';
import type {
  NotificationOutboxReplayResponseDto,
  NotificationReplayRefusalCode,
} from './notification-outbox-replay.dto.js';
import { NOTIFICATION_UNSENT_WINDOW_MS } from './notification-retry.policy.js';

/**
 * Roles that may replay a dead letter. A replay sends a customer message again, so it is an administrator's act,
 * not an advisor's.
 */
export const NOTIFICATION_REPLAY_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'ADMIN',
]);

/**
 * Admin replay of dead-lettered notifications (runbook §5a; route `POST /api/notifications/outbox/replay`).
 *
 * Only FAILED rows whose body is still stored go back to PENDING, with a fresh attempt budget. Each row is one
 * guarded `updateMany` on its id, tenant and FAILED status, so a row that another request already moved is refused
 * instead of sent twice. The wake-up is queued after that update has committed, as the recovery sweep does. A
 * refused row is never sent by this request.
 */
@Injectable()
export class NotificationOutboxReplayService {
  private readonly logger = new Logger(NotificationOutboxReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly wakeUps: NotificationCloudTasksService,
  ) {}

  async replay(
    ids: string[],
    now = new Date(),
  ): Promise<NotificationOutboxReplayResponseDto> {
    this.assertReplayRole();
    const replayed: string[] = [];
    const refused: { id: string; code: NotificationReplayRefusalCode }[] = [];

    for (const id of ids) {
      const outcome = await this.replayOne(id, now);
      if (outcome.refusal !== undefined) {
        refused.push({ id, code: outcome.refusal });
        continue;
      }
      replayed.push(id);
      await this.wake(id, outcome.tenantId);
    }

    return { replayed, refused };
  }

  private async replayOne(
    id: string,
    now: Date,
  ): Promise<
    | { refusal: NotificationReplayRefusalCode; tenantId?: undefined }
    | { refusal?: undefined; tenantId: string }
  > {
    const row = await this.prisma.notificationOutbox.findFirst({
      where: { id },
      select: {
        id: true,
        tenant_id: true,
        status: true,
        channel: true,
        body: true,
        body_sha256: true,
        body_purged_at: true,
        createdAt: true,
      },
    });
    if (!row) {
      return { refusal: 'NOT_FOUND' };
    }
    if (row.status !== NotificationOutboxStatus.FAILED) {
      return { refusal: 'NOT_FAILED' };
    }
    if (row.body_purged_at !== null) {
      return { refusal: 'BODY_PURGED' };
    }
    // The sweep fails a PENDING row this old as STALE_UNSENT and clears its body, so a replay would only wipe the
    // row's last error. The worker claims rows inside the same window (runbook §5a).
    if (
      row.createdAt < new Date(now.getTime() - NOTIFICATION_UNSENT_WINDOW_MS)
    ) {
      return { refusal: 'STALE_UNSENT' };
    }
    if (row.channel === NotificationChannel.EMAIL) {
      if (row.body === null || row.body_sha256 === null) {
        return { refusal: 'BODY_MISSING' };
      }
      // The failed write removed the approval link (ADR-0025 §7). Sending the body again would send the placeholder,
      // so the estimate goes out again as a new version, which mints a new link.
      if (row.body.includes(REDACTED_APPROVAL_LINK)) {
        return { refusal: 'LINK_REDACTED' };
      }
    }

    const result = await this.prisma.notificationOutbox.updateMany({
      where: {
        id: row.id,
        tenant_id: row.tenant_id,
        status: NotificationOutboxStatus.FAILED,
        body_purged_at: null,
      },
      data: {
        status: NotificationOutboxStatus.PENDING,
        attempts: 0,
        next_attempt_at: now,
        failed_at: null,
        lease_token: null,
        lease_expires_at: null,
      },
    });
    if (result.count !== 1) {
      return { refusal: 'NOT_FAILED' };
    }
    return { tenantId: row.tenant_id };
  }

  /** A failed wake-up leaves the row PENDING; the recovery sweep wakes it later. */
  private async wake(outboxId: string, tenantId: string): Promise<void> {
    await this.wakeUps
      .enqueueWakeUp({ outboxId, tenantId })
      .catch((cause: unknown) =>
        this.logger.warn(
          `Could not wake replayed notification ${outboxId}: ${cause instanceof Error ? cause.name : 'unknown error'}`,
        ),
      );
  }

  private assertReplayRole(): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.role || !NOTIFICATION_REPLAY_ROLES.has(user.role)) {
      throw new ForbiddenException(
        'Only an owner or an admin can replay notifications.',
      );
    }
  }
}
