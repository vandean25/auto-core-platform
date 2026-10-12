import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildNotificationOutboxRow,
  type EnqueueNotificationInput,
} from './notification-outbox.rows.js';

export type NotificationOutboxTxClient = Prisma.TransactionClient;

export interface EnqueuedNotification {
  id: string;
  /** False when the same event, occurrence, recipient and channel was already written. */
  created: boolean;
}

@Injectable()
export class NotificationOutboxService {
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
    const row = buildNotificationOutboxRow(input, now);
    const result = await tx.notificationOutbox.createMany({
      data: [row],
      skipDuplicates: true,
    });
    if (result.count === 1) {
      return { id: row.id, created: true };
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
    return { id: existing.id, created: false };
  }
}
