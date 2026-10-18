import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CustomerConsentOutboundUnsubscribeService } from '../customer-consent/customer-consent-outbound-unsubscribe.service.js';
import type { ContactPermissionReason } from '../customer-consent/customer-consent.permissions.js';
import {
  evaluateOutboxContactPermission,
  writeOutboxContactBlockAudit,
} from './notification-outbox-contact-guard.js';
import {
  buildNotificationOutboxRow,
  type EnqueueNotificationInput,
} from './notification-outbox.rows.js';

export type NotificationOutboxTxClient = Prisma.TransactionClient;

export type EnqueuedNotification =
  | {
      blocked: false;
      id: string;
      /** False when the same event, occurrence, recipient and channel was already written. */
      created: boolean;
    }
  | {
      blocked: true;
      reason: ContactPermissionReason;
    };

@Injectable()
export class NotificationOutboxService {
  constructor(
    private readonly marketingUnsubscribe: CustomerConsentOutboundUnsubscribeService,
  ) {}

  /**
   * Writes one outbox row inside the caller's transaction. Call it in the same `$transaction` as the
   * state change it announces, so the row exists if and only if that change committed (ADR-0025 §6).
   * A repeated write for the same key is a no-op: `createMany` with `skipDuplicates` does not abort
   * the Postgres transaction the way a caught unique violation would.
   */
  async enqueueInTx(
    tx: NotificationOutboxTxClient,
    input: EnqueueNotificationInput,
    now: Date = new Date(),
  ): Promise<EnqueuedNotification> {
    const permission = await evaluateOutboxContactPermission(tx, input);
    if (permission.action === 'block') {
      await writeOutboxContactBlockAudit(
        tx,
        input,
        permission.customerId,
        permission.reason,
      );
      return { blocked: true, reason: permission.reason };
    }

    const prepared = await this.appendMarketingUnsubscribeLink(input);
    const row = buildNotificationOutboxRow(prepared, now);
    const result = await tx.notificationOutbox.createMany({
      data: [row],
      skipDuplicates: true,
    });
    if (result.count === 1) {
      return { blocked: false, id: row.id, created: true };
    }

    const existing = await tx.notificationOutbox.findFirst({
      where: {
        tenant_id: input.tenantId,
        idempotency_key: row.idempotency_key,
      },
      select: { id: true },
    });
    if (!existing) {
      throw new Error(
        `Notification outbox row ${row.idempotency_key} was neither created nor found`,
      );
    }
    return { blocked: false, id: existing.id, created: false };
  }

  private async appendMarketingUnsubscribeLink(
    input: EnqueueNotificationInput,
  ): Promise<EnqueueNotificationInput> {
    if (!input.marketingUnsubscribe || !input.email) {
      return input;
    }
    const token = await this.marketingUnsubscribe.mintTokenForMarketingMessage(
      input.marketingUnsubscribe,
    );
    const origin = process.env.FRONTEND_URL?.trim() || 'http://localhost:5173';
    const url = this.marketingUnsubscribe.buildUnsubscribePostUrl(
      origin,
      token,
    );
    return {
      ...input,
      email: {
        ...input.email,
        text: `${input.email.text}\n\n${url}`,
      },
    };
  }
}
