import { randomUUID } from 'node:crypto';
import {
  NotificationChannel,
  NotificationMessageClass,
  NotificationOutboxStatus,
  type CustomerConsentPurpose,
  type NotificationEventType,
  type NotificationRecipientKind,
  type Prisma,
} from '@prisma/client';
import {
  buildEmailColumns,
  type EmailDraft,
} from './notification-outbox.email-columns.js';
import type { MarketingUnsubscribeEmailContext } from '../customer-consent/customer-consent-outbound-unsubscribe.service.js';

export type { EmailDraft } from './notification-outbox.email-columns.js';

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
  workshopOrderId?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  payload?: Prisma.InputJsonObject;
  /** Required for EMAIL rows and forbidden for IN_APP rows. */
  email?: EmailDraft;
  /** When set, a marketing unsubscribe token is minted and appended to the email body. */
  marketingUnsubscribe?: MarketingUnsubscribeEmailContext;
  /** Required for customer EMAIL rows; drives canContact before enqueue (AUT-610). */
  consentPurpose?: CustomerConsentPurpose;
  /**
   * Sender controller for consent ledger lookup. When omitted, the guard uses this id only if the
   * tenant has exactly one active legal entity; otherwise consent blocks with NO_CONTACT_POINT.
   * Workshop customer email callers should pass the seller legal entity id explicitly.
   */
  controllerLegalEntityId?: string;
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
  Prisma.NotificationOutboxUncheckedCreateInput & {
    id: string;
  };

/**
 * Row shape for `notification_outbox`. IN_APP rows are accepted at write time, because the durable
 * row is the notification itself. EMAIL rows start PENDING and are delivered by the sender worker.
 */
export function buildNotificationOutboxRow(
  input: EnqueueNotificationInput,
  now: Date,
): NotificationOutboxRow {
  assertMessageMatchesChannel(input);
  return {
    ...buildRowIdentity(input),
    ...buildEmailColumns(input.email),
    ...buildRowLifecycle(input.channel !== NotificationChannel.EMAIL, now),
  };
}

function assertMessageMatchesChannel(input: EnqueueNotificationInput): void {
  const isEmail = input.channel === NotificationChannel.EMAIL;
  if (isEmail && !input.email) {
    throw new Error('EMAIL outbox rows need a rendered message');
  }
  if (!isEmail && input.email) {
    throw new Error('Only EMAIL outbox rows carry a rendered message');
  }
}

function buildRowIdentity(input: EnqueueNotificationInput) {
  return {
    id: randomUUID(),
    tenant_id: input.tenantId,
    event_type: input.eventType,
    idempotency_key: buildNotificationIdempotencyKey(input),
    channel: input.channel,
    recipient_kind: input.recipientKind,
    message_class: NotificationMessageClass.TRANSACTIONAL,
    workshop_order_id: input.workshopOrderId ?? null,
    source_entity_type: input.sourceEntityType ?? null,
    source_entity_id: input.sourceEntityId ?? null,
    ...(input.payload ? { payload: input.payload } : {}),
  };
}

function buildRowLifecycle(acceptedAtWrite: boolean, now: Date) {
  const timestamps = { next_attempt_at: now, createdAt: now, updatedAt: now };
  if (acceptedAtWrite) {
    return {
      ...timestamps,
      status: NotificationOutboxStatus.ACCEPTED,
      attempts: 0,
      accepted_at: now,
      provider: 'in-app',
    };
  }
  return {
    ...timestamps,
    status: NotificationOutboxStatus.PENDING,
    attempts: 0,
    accepted_at: null,
    provider: null,
  };
}
