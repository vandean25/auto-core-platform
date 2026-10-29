import { Injectable } from '@nestjs/common';
import { NotificationRecipientKind, type Prisma } from '@prisma/client';
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

  /**
   * Writes several internal-team rows in the caller's transaction with one insert (a PUSH row per recipient, ADR-0033).
   * Customer rows are refused: they need the contact check of `enqueueInTx`. A repeated key is a no-op, and the result
   * says which rows are new, so the caller wakes the worker only for those after the commit.
   */
  async enqueueInternalManyInTx(
    tx: NotificationOutboxTxClient,
    inputs: EnqueueNotificationInput[],
    now: Date = new Date(),
  ): Promise<Array<{ id: string; created: boolean }>> {
    if (inputs.length === 0) return [];
    const tenantId = inputs[0].tenantId;
    if (
      inputs.some(
        (input) =>
          input.tenantId !== tenantId ||
          input.recipientKind !== NotificationRecipientKind.INTERNAL_TEAM,
      )
    ) {
      throw new Error(
        'enqueueInternalManyInTx takes internal rows of one tenant only',
      );
    }
    const rows = inputs.map((input) => buildNotificationOutboxRow(input, now));
    const result = await tx.notificationOutbox.createMany({
      data: rows,
      skipDuplicates: true,
    });
    if (result.count === rows.length) {
      return rows.map((row) => ({ id: row.id, created: true }));
    }
    const existing = await tx.notificationOutbox.findMany({
      where: {
        tenant_id: tenantId,
        idempotency_key: { in: rows.map((row) => row.idempotency_key) },
      },
      select: { id: true, idempotency_key: true },
    });
    const idByKey = new Map(
      existing.map((row) => [row.idempotency_key, row.id]),
    );
    return rows.map((row) => {
      const id = idByKey.get(row.idempotency_key);
      if (!id) {
        throw new Error(
          `Notification outbox row ${row.idempotency_key} was neither created nor found`,
        );
      }
      return { id, created: id === row.id };
    });
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
