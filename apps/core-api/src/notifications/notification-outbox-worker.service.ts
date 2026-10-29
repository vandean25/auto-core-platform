import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  type NotificationEventType,
  NotificationOutboxStatus,
  NotificationRecipientKind,
  type Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import {
  PushDeliveryService,
  type PushDeliveryOutcome,
} from '../push/push-delivery.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { isPlainEmailAddress } from './email/email-address.js';
import { isSingleLineText } from './email/header-text.js';
import { redactApprovalLinks } from './notification-body-redaction.js';
import { withdrawConfirmationAfterRefusal } from './notification-email-confirmation.js';
import {
  EmailProviderError,
  type EmailSendResult,
  type OutgoingEmail,
} from './email/email-provider.js';
import { EmailProviderResolver } from './email/email-provider.resolver.js';
import { NotificationCloudTasksService } from './notification-cloud-tasks.service.js';
import { decideEmailDelivery } from './notification-decision.js';
import {
  readNotificationDeliveryConfig,
  type NotificationDeliveryConfig,
} from './notification-delivery.config.js';
import {
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_UNSENT_WINDOW_MS,
  nextRetryDelaySeconds,
} from './notification-retry.policy.js';

/** A claim with no result after this long is treated as lost and reclaimed by the recovery sweep. */
export const NOTIFICATION_LEASE_MS = 120_000;
export const NOTIFICATION_PROVIDER_TIMEOUT_MS = 15_000;
/** The scheduling slack of a Cloud Tasks wake-up: whole seconds, so up to one second early. */
export const NOTIFICATION_CLAIM_TOLERANCE_MS = 1_000;
/** The provider codes that may reach the row. Anything else is replaced, so no free text is stored. */
const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;
/** Writes of the status after the provider accepted: a few tries, then the failure is logged, never resent. */
const ACCEPTED_WRITE_ATTEMPTS = 3;

interface ClaimedRow {
  channel: NotificationChannel;
  event_type: NotificationEventType;
  recipient_user_id: string | null;
  workshop_order_id: string | null;
  createdAt: Date;
  recipient_kind: NotificationRecipientKind;
  payload: Prisma.JsonValue | null;
  recipient_email: string | null;
  subject: string | null;
  body: string | null;
  sender_name: string | null;
  reply_to_email: string | null;
  attempts: number;
}

interface Failure {
  code: string;
  message: string;
  /** A permanent refusal of the address itself, a hard bounce (ADR-0025 §8). */
  recipientRejected?: boolean;
}

interface Attempt {
  outboxId: string;
  tenantId: string;
  leaseToken: string;
  row: ClaimedRow;
  now: Date;
  config: NotificationDeliveryConfig;
}

/**
 * Sends one due outbox row. Every write is fenced by `lease_token`, so a stale attempt can never
 * overwrite a newer one. The worker route answers 204 for every handled outcome, so Cloud Tasks does
 * not retry on its own; retries are scheduled here through the outbox row (ADR-0007 pattern).
 */
@Injectable()
export class NotificationOutboxWorkerService {
  private readonly logger = new Logger(NotificationOutboxWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: EmailProviderResolver,
    private readonly wakeUps: NotificationCloudTasksService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly push: PushDeliveryService,
  ) {}

  /** One attempt for one row. Called by the Cloud Tasks worker route, never by a request handler. */
  async deliver(
    outboxId: string,
    tenantId: string,
    now: Date = new Date(),
    config: NotificationDeliveryConfig = readNotificationDeliveryConfig(),
  ): Promise<void> {
    // A suspended tenant sends nothing. Its rows are not claimed, so they keep their place: they go out
    // after reactivation, or the sweep fails them once the sending window passes.
    if (!(await this.isTenantActive(tenantId))) {
      return;
    }
    const leaseToken = randomUUID();
    // Cloud Tasks schedules whole seconds, so a retry's wake-up can fire up to a second before the row's
    // next_attempt_at. Claiming it then is correct, so the due check allows that much.
    const dueBy = new Date(now.getTime() + NOTIFICATION_CLAIM_TOLERANCE_MS);
    const windowStart = new Date(now.getTime() - NOTIFICATION_UNSENT_WINDOW_MS);
    const claimed = await this.prisma.notificationOutbox.updateMany({
      where: {
        id: outboxId,
        tenant_id: tenantId,
        // A row that used its last attempt is failed by the recovery sweep, never claimed again.
        attempts: { lt: NOTIFICATION_MAX_ATTEMPTS },
        // A row older than the sending window is failed by the sweep, so no claim takes it, PENDING or expired.
        createdAt: { gte: windowStart },
        OR: [
          {
            status: NotificationOutboxStatus.PENDING,
            next_attempt_at: { lte: dueBy },
          },
          {
            status: NotificationOutboxStatus.SENDING,
            lease_expires_at: { lt: now },
          },
        ],
      },
      data: {
        status: NotificationOutboxStatus.SENDING,
        attempts: { increment: 1 },
        lease_token: leaseToken,
        lease_expires_at: new Date(now.getTime() + NOTIFICATION_LEASE_MS),
      },
    });
    if (claimed.count !== 1) {
      return;
    }

    const row = await this.prisma.notificationOutbox.findFirst({
      where: { id: outboxId, tenant_id: tenantId, lease_token: leaseToken },
      select: {
        channel: true,
        event_type: true,
        recipient_user_id: true,
        workshop_order_id: true,
        createdAt: true,
        recipient_kind: true,
        payload: true,
        recipient_email: true,
        subject: true,
        body: true,
        sender_name: true,
        reply_to_email: true,
        attempts: true,
      },
    });
    if (!row) {
      this.logger.warn(
        `Claimed notification ${outboxId} was not found under its lease`,
      );
      return;
    }

    const attempt: Attempt = {
      outboxId,
      tenantId,
      leaseToken,
      row,
      now,
      config,
    };
    try {
      await this.attempt(attempt);
    } catch (cause) {
      // Anything the attempt did not expect is a transient failure under the lease, so the retry is
      // scheduled now instead of when the lease expires.
      this.logger.error(
        `Unexpected failure while sending notification ${outboxId}: ${cause instanceof Error ? cause.name : 'unknown error'}`,
      );
      await this.retryOrFail(attempt, {
        code: 'UNEXPECTED_ERROR',
        message: 'Unexpected sender error',
      });
    }
  }

  private attempt(a: Attempt): Promise<void> {
    if (a.row.channel === NotificationChannel.PUSH) {
      return this.attemptPush(a);
    }
    if (a.row.channel === NotificationChannel.EMAIL) {
      return this.attemptEmail(a);
    }
    // IN_APP rows are written ACCEPTED, so only a future writer can reach this guard.
    return this.fail(a, {
      code: 'UNSUPPORTED_CHANNEL',
      message: 'This channel has no sender',
    });
  }

  private async attemptEmail(a: Attempt): Promise<void> {
    const recipient = a.row.recipient_email;
    if (!recipient) {
      return this.fail(a, {
        code: 'RECIPIENT_MISSING',
        message: 'The outbox row has no recipient address',
      });
    }
    if (!isPlainEmailAddress(recipient)) {
      return this.fail(a, {
        code: 'RECIPIENT_INVALID',
        message: 'The recipient is not one plain address',
      });
    }

    const decision = decideEmailDelivery({
      mode: a.config.mode,
      liveProvider: a.config.liveProvider,
      allowlist: a.config.allowlist,
      recipientEmail: recipient,
    });
    if (decision.action === 'suppress') {
      return this.record(a, {
        status: NotificationOutboxStatus.SUPPRESSED,
        suppressed_reason: decision.reason,
        last_error_code: null,
        last_error_message: null,
      });
    }

    if (!a.config.fromAddress) {
      // Deployment configuration, not row data: retried, so a fixed configuration still delivers.
      return this.retryOrFail(a, {
        code: 'SENDER_NOT_CONFIGURED',
        message: 'The sender address is not configured',
      });
    }
    const content = readEmailContent(a.row);
    if ('code' in content) {
      return this.fail(a, content);
    }
    const message: OutgoingEmail = {
      to: recipient,
      from: { email: a.config.fromAddress, name: content.senderName },
      replyTo: a.row.reply_to_email
        ? { email: a.row.reply_to_email, name: content.senderName }
        : null,
      subject: content.subject,
      text: content.body,
      tags: [a.row.event_type],
    };

    SideEffectGuard.assertAllowed('EMAIL');
    const provider = this.providers.resolve(decision.provider);
    let accepted: EmailSendResult;
    try {
      accepted = await withProviderDeadline(
        provider.send(message, {
          idempotencyKey: a.outboxId,
          signal: AbortSignal.timeout(NOTIFICATION_PROVIDER_TIMEOUT_MS),
        }),
        NOTIFICATION_PROVIDER_TIMEOUT_MS,
      );
    } catch (error) {
      return this.recordEmailSendError(a, error);
    }
    // The provider has accepted the message, so nothing from here may schedule another send.
    return this.recordAccepted(a, {
      status: NotificationOutboxStatus.ACCEPTED,
      provider: provider.name,
      provider_message_id: accepted.providerMessageId,
      accepted_at: a.now,
      last_error_code: null,
      last_error_message: null,
    });
  }

  private async recordEmailSendError(
    a: Attempt,
    error: unknown,
  ): Promise<void> {
    const failure = toProviderFailure(error);
    if (failure.transient) {
      return this.retryOrFail(a, failure);
    }
    if (failure.recipientRejected) {
      await this.fail(a, failure);
      return withdrawConfirmationAfterRefusal(this.prisma, {
        tenantId: a.tenantId,
        outboxId: a.outboxId,
        recipientKind: a.row.recipient_kind,
        recipientEmail: a.row.recipient_email,
        payload: a.row.payload,
      });
    }
    return this.fail(a, failure);
  }

  /** A PUSH row (ADR-0033): the push sender decides, and the outcome is written to the row like an email's. */
  private async attemptPush(a: Attempt): Promise<void> {
    const outcome = await this.push.deliver(
      {
        outboxId: a.outboxId,
        tenantId: a.tenantId,
        eventType: a.row.event_type,
        recipientUserId: a.row.recipient_user_id,
        workshopOrderId: a.row.workshop_order_id,
        payload: a.row.payload,
        createdAt: a.row.createdAt,
      },
      a.now,
    );
    return this.recordPushOutcome(a, outcome);
  }

  private recordPushOutcome(
    a: Attempt,
    outcome: PushDeliveryOutcome,
  ): Promise<void> {
    switch (outcome.kind) {
      case 'accepted':
        // A push is never resent once any device accepted it, so a failed status write is only retried, never rescheduled.
        return this.recordAccepted(a, {
          status: NotificationOutboxStatus.ACCEPTED,
          provider: 'fcm',
          accepted_at: a.now,
          last_error_code: null,
          last_error_message: null,
        });
      case 'suppressed':
        return this.record(a, {
          status: NotificationOutboxStatus.SUPPRESSED,
          suppressed_reason: outcome.reason,
          last_error_code: null,
          last_error_message: null,
        });
      case 'retry':
        return this.retryOrFail(a, outcome);
      case 'failed':
        return this.fail(a, outcome);
    }
  }

  /** Read under SystemPrisma, like the sweeps that walk every tenant. */
  private async isTenantActive(tenantId: string): Promise<boolean> {
    const tenant = await this.systemPrisma.tenant.findFirst({
      where: { id: tenantId },
      select: { is_active: true },
    });
    return tenant?.is_active === true;
  }

  /** Schedules the next attempt, or fails the row once it has used its last attempt. */
  private async retryOrFail(a: Attempt, failure: Failure): Promise<void> {
    const delaySeconds = nextRetryDelaySeconds(a.row.attempts);
    if (delaySeconds === null) {
      return this.fail(a, {
        code: 'MAX_ATTEMPTS_EXCEEDED',
        message: `${failure.message} (last error ${failure.code})`,
      });
    }

    const released = await this.prisma.notificationOutbox.updateMany({
      where: {
        id: a.outboxId,
        tenant_id: a.tenantId,
        status: NotificationOutboxStatus.SENDING,
        lease_token: a.leaseToken,
      },
      data: {
        status: NotificationOutboxStatus.PENDING,
        next_attempt_at: new Date(a.now.getTime() + delaySeconds * 1000),
        last_error_code: failure.code,
        last_error_message: failure.message,
        lease_token: null,
        lease_expires_at: null,
      },
    });
    if (released.count !== 1) {
      this.logger.warn(
        `Lease for notification ${a.outboxId} was lost before the retry was recorded`,
      );
      return;
    }
    await this.wakeUps
      .enqueueWakeUp({
        outboxId: a.outboxId,
        tenantId: a.tenantId,
        delaySeconds,
      })
      .catch((cause: unknown) =>
        this.logger.warn(
          `Could not schedule retry for notification ${a.outboxId}: ${cause instanceof Error ? cause.name : 'unknown error'}`,
        ),
      );
  }

  private fail(a: Attempt, failure: Failure): Promise<void> {
    return this.record(a, {
      status: NotificationOutboxStatus.FAILED,
      failed_at: a.now,
      last_error_code: failure.code,
      last_error_message: failure.message,
    });
  }

  /** Writes the terminal outcome under the lease. A lost lease is logged, never overwritten. */
  private async record(
    a: Attempt,
    outcome: Prisma.NotificationOutboxUncheckedUpdateManyInput,
  ): Promise<void> {
    const result = await this.prisma.notificationOutbox.updateMany({
      where: {
        id: a.outboxId,
        tenant_id: a.tenantId,
        status: NotificationOutboxStatus.SENDING,
        lease_token: a.leaseToken,
      },
      data: {
        ...outcome,
        // A terminal row keeps no approval link (ADR-0025 §7). Retries are scheduled elsewhere and keep the body.
        body: redactApprovalLinks(a.row.body),
        lease_token: null,
        lease_expires_at: null,
      },
    });
    if (result.count !== 1) {
      this.logger.warn(
        `Lease for notification ${a.outboxId} was lost before the outcome was recorded`,
      );
    }
  }

  /**
   * The provider accepted the message, so a failed status write must not reschedule the send: a retry would
   * send the notice again. The write is tried a few times, then logged. The claim then expires and the sweep
   * resends the notice, which is the at-least-once limit the runbook records.
   */
  private async recordAccepted(
    a: Attempt,
    outcome: Prisma.NotificationOutboxUncheckedUpdateManyInput,
  ): Promise<void> {
    for (let write = 1; write <= ACCEPTED_WRITE_ATTEMPTS; write += 1) {
      try {
        await this.record(a, outcome);
        return;
      } catch (cause) {
        this.logger.warn(
          `Status write ${write} for accepted notification ${a.outboxId} failed: ${cause instanceof Error ? cause.name : 'unknown error'}`,
        );
      }
    }
    this.logger.error(
      `Notification ${a.outboxId} was accepted by the provider, but its status was not written`,
    );
  }
}

/**
 * Gives up on a provider call after `ms`, even when the adapter ignores its abort signal, so every attempt
 * records its outcome before the lease expires. A late answer is dropped. The idempotency key lets a
 * provider that supports it dedupe the retry that follows.
 */
/** The sender name, subject and body of an EMAIL row, or why the row cannot be sent. */
function readEmailContent(
  row: ClaimedRow,
): Failure | { senderName: string; subject: string; body: string } {
  const senderName = row.sender_name;
  const subject = row.subject;
  const body = row.body;
  // Blank counts as missing, like the writer's check: a blank subject or body would reach the provider.
  if (!senderName?.trim() || !subject?.trim() || !body?.trim()) {
    return {
      code: 'MESSAGE_INCOMPLETE',
      message: 'The outbox row has no sender name, subject or body',
    };
  }
  // The builder checks these too; the worker checks again, since any writer of the row could skip it.
  if (
    !isSingleLineText(senderName) ||
    !isSingleLineText(subject) ||
    (row.reply_to_email && !isPlainEmailAddress(row.reply_to_email))
  ) {
    return {
      code: 'MESSAGE_INVALID',
      message: 'The outbox row has a value that is unsafe in an email header',
    };
  }
  return { senderName, subject, body };
}

function withProviderDeadline<T>(call: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new EmailProviderError(
            'transient',
            'TIMEOUT',
            'The provider did not answer in time',
          ),
        ),
      ms,
    );
  });
  return Promise.race([call, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Maps anything a provider throws to a failure we can store. The stored text is always a fixed sentence,
 * because a provider message can name the address. Unknown errors are retried, never leaked.
 */
function toProviderFailure(error: unknown): Failure & { transient: boolean } {
  if (error instanceof EmailProviderError) {
    const transient = error.kind === 'transient';
    return {
      code: PROVIDER_CODE.test(error.code) ? error.code : 'PROVIDER_ERROR',
      message: transient
        ? 'The provider did not accept the message'
        : 'The provider refused the message',
      transient,
      recipientRejected: error.kind === 'recipient_rejected',
    };
  }
  return {
    code: 'UNEXPECTED_ERROR',
    message: 'Unexpected sender error',
    transient: true,
    recipientRejected: false,
  };
}
