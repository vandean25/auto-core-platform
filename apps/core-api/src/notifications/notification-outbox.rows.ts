import { randomUUID } from 'node:crypto';
import {
  NotificationChannel,
  NotificationMessageClass,
  NotificationOutboxStatus,
  type NotificationEventType,
  type NotificationRecipientKind,
  type Prisma,
} from '@prisma/client';

/**
 * One outbox write. `occurrenceId` names the business occurrence that happened once, for example
 * the labor entry a pause closed. `recipientKey` is a stable, non-personal key ('advisors' or
 * 'customer:<id>'); it keeps personal data out of the unique index (ADR-0025 §6, AUT-356).
 */
export interface EnqueueNotificationInput {
  tenantId: string;
  eventType: NotificationEventType;
  occurrenceId: string;
  channel: NotificationChannel;
  recipientKind: NotificationRecipientKind;
  recipientKey: string;
  recipientEmail?: string | null;
  workshopOrderId?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  payload?: Prisma.InputJsonObject;
}

/** Event, occurrence, recipient and channel: a repeated write for the same key is a no-op. */
export function buildNotificationIdempotencyKey(
  input: Pick<
    EnqueueNotificationInput,
    'eventType' | 'occurrenceId' | 'recipientKey' | 'channel'
  >,
): string {
  return [
    input.eventType,
    input.occurrenceId,
    input.recipientKey,
    input.channel,
  ].join(':');
}

export type NotificationOutboxRow =
  Prisma.NotificationOutboxUncheckedCreateInput & { id: string };

/**
 * Row shape for `notification_outbox`. Channels without a provider (IN_APP) are accepted at write
 * time, because the durable row is the notification itself. EMAIL rows start PENDING and are
 * delivered by the sender worker (AUT-356 phase 2).
 */
export function buildNotificationOutboxRow(
  input: EnqueueNotificationInput,
  now: Date,
): NotificationOutboxRow {
  const acceptedAtWrite = input.channel === NotificationChannel.IN_APP;
  return {
    id: randomUUID(),
    tenant_id: input.tenantId,
    event_type: input.eventType,
    idempotency_key: buildNotificationIdempotencyKey(input),
    channel: input.channel,
    recipient_kind: input.recipientKind,
    recipient_email: input.recipientEmail ?? null,
    message_class: NotificationMessageClass.TRANSACTIONAL,
    workshop_order_id: input.workshopOrderId ?? null,
    source_entity_type: input.sourceEntityType ?? null,
    source_entity_id: input.sourceEntityId ?? null,
    ...(input.payload ? { payload: input.payload } : {}),
    status: acceptedAtWrite
      ? NotificationOutboxStatus.ACCEPTED
      : NotificationOutboxStatus.PENDING,
    attempts: 0,
    next_attempt_at: now,
    accepted_at: acceptedAtWrite ? now : null,
    provider: acceptedAtWrite ? 'in-app' : null,
    createdAt: now,
    updatedAt: now,
  };
}
