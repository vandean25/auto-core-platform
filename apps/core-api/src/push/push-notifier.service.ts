import { Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientKind,
  type NotificationEventType,
  type Prisma,
} from '@prisma/client';
import { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { wakeUpAfterCommit } from '../workshop/workshop-estimate-email-queue.js';
import { resolvePushRecipients } from './push-recipients.js';

export interface OrderPushEvent {
  tenantId: string;
  siteId: string;
  workshopOrderId: string;
  eventType: NotificationEventType;
  /** The business occurrence that happened once (domain event id, labor entry id). */
  occurrenceId: string;
  extraEmployeeIds?: string[];
  /** Becomes the outbox payload; only fields the push message reads, never customer data. */
  payload?: Prisma.InputJsonObject;
  sourceEntityType?: string;
  sourceEntityId?: string;
}

/** Writes the PUSH rows of an order event and wakes the worker for them after the commit (ADR-0033 §2). */
@Injectable()
export class PushNotifierService {
  constructor(
    private readonly outbox: NotificationOutboxService,
    private readonly wakeUps: NotificationCloudTasksService,
  ) {}

  /**
   * Call inside the transaction of the state change, so a row exists if and only if the change committed. Returns the
   * rows that are new; pass them to `wakeUp` after the commit.
   */
  async enqueueInTx(
    tx: Prisma.TransactionClient,
    event: OrderPushEvent,
    now: Date = new Date(),
  ): Promise<string[]> {
    const recipients = await resolvePushRecipients(tx, event);
    const written = await this.outbox.enqueueInternalManyInTx(
      tx,
      recipients.map((userId) => ({
        tenantId: event.tenantId,
        eventType: event.eventType,
        occurrenceId: event.occurrenceId,
        channel: NotificationChannel.PUSH,
        recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
        recipientKey: `user:${userId}`,
        recipientUserId: userId,
        workshopOrderId: event.workshopOrderId,
        sourceEntityType: event.sourceEntityType,
        sourceEntityId: event.sourceEntityId,
        payload: event.payload,
      })),
      now,
    );
    return written.filter((row) => row.created).map((row) => row.id);
  }

  /** After the commit. A failed wake-up is logged only: the recovery sweep wakes the row once its grace has passed. */
  async wakeUp(tenantId: string, outboxIds: string[]): Promise<void> {
    await Promise.all(
      outboxIds.map((id) => wakeUpAfterCommit(this.wakeUps, id, tenantId)),
    );
  }
}
