import {
  AuditActorType,
  AuditLogAction,
  NotificationChannel,
  NotificationRecipientKind,
  type CustomerConsentChannel,
  type CustomerConsentPurpose,
  type Prisma,
} from '@prisma/client';
import {
  canContact,
  type ContactPermissionReason,
  type LedgerEventSlice,
} from '../customer-consent/customer-consent.permissions.js';
import type { EnqueueNotificationInput } from './notification-outbox.rows.js';

const CUSTOMER_RECIPIENT_KEY = /^customer:([^:]+)$/;

export type OutboxContactGuardDecision =
  | { action: 'allow' }
  | { action: 'block'; reason: ContactPermissionReason; customerId: string };

export function consentChannelForNotification(
  channel: NotificationChannel,
): CustomerConsentChannel | null {
  if (channel === NotificationChannel.EMAIL) {
    return 'EMAIL';
  }
  return null;
}

export function parseCustomerIdFromRecipientKey(
  recipientKey: string,
): string | null {
  const match = CUSTOMER_RECIPIENT_KEY.exec(recipientKey);
  return match?.[1] ?? null;
}

/**
 * Customer EMAIL rows that name a workshop customer id require a consent check before enqueue.
 * Landing-demo magic link mail is CUSTOMER + EMAIL but uses recipientKey `landing-demo:<email>`,
 * so it intentionally bypasses canContact (no workshop customer id in the key).
 */
export function requiresOutboxContactCheck(
  input: EnqueueNotificationInput,
): boolean {
  if (input.recipientKind !== NotificationRecipientKind.CUSTOMER) {
    return false;
  }
  if (!consentChannelForNotification(input.channel)) {
    return false;
  }
  return parseCustomerIdFromRecipientKey(input.recipientKey) !== null;
}

export async function resolveControllerLegalEntityIdInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  explicitId?: string,
): Promise<string | null> {
  if (explicitId) {
    const entity = await tx.legalEntity.findFirst({
      where: { tenant_id: tenantId, id: explicitId, is_active: true },
      select: { id: true },
    });
    return entity?.id ?? null;
  }
  const active = await tx.legalEntity.findMany({
    where: { tenant_id: tenantId, is_active: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  if (active.length === 1) {
    return active[0].id;
  }
  return null;
}

function mapLedgerRows(
  rows: Array<{
    purpose: CustomerConsentPurpose;
    channel: CustomerConsentChannel;
    status: LedgerEventSlice['status'];
    sequence: number;
    basis: LedgerEventSlice['basis'];
    text_version: string | null;
    text_snapshot: string | null;
    evidence: Prisma.JsonValue | null;
  }>,
): LedgerEventSlice[] {
  return rows.map((row) => ({
    purpose: row.purpose,
    channel: row.channel,
    status: row.status,
    sequence: row.sequence,
    basis: row.basis,
    text_version: row.text_version,
    text_snapshot: row.text_snapshot,
    evidence: row.evidence as LedgerEventSlice['evidence'],
  }));
}

export async function evaluateOutboxContactPermission(
  tx: Prisma.TransactionClient,
  input: EnqueueNotificationInput,
): Promise<OutboxContactGuardDecision> {
  if (!requiresOutboxContactCheck(input)) {
    return { action: 'allow' };
  }

  const customerId = parseCustomerIdFromRecipientKey(input.recipientKey)!;
  const channel = consentChannelForNotification(input.channel)!;
  const purpose = input.consentPurpose;
  if (!purpose) {
    return {
      action: 'block',
      reason: 'NO_CONTACT_POINT',
      customerId,
    };
  }

  const controllerId = await resolveControllerLegalEntityIdInTx(
    tx,
    input.tenantId,
    input.controllerLegalEntityId,
  );
  if (!controllerId) {
    return { action: 'block', reason: 'NO_CONTACT_POINT', customerId };
  }

  const customer = await tx.customer.findFirst({
    where: { tenant_id: input.tenantId, id: customerId },
    select: { contact_email_ok: true },
  });
  if (!customer) {
    return { action: 'block', reason: 'NO_CONTACT_POINT', customerId };
  }

  const state = await tx.customerCommunicationState.findFirst({
    where: {
      tenant_id: input.tenantId,
      controller_legal_entity_id: controllerId,
      customer_id: customerId,
    },
    select: { processing_status: true },
  });

  const events = await tx.customerConsent.findMany({
    where: {
      tenant_id: input.tenantId,
      customer_id: customerId,
      controller_legal_entity_id: controllerId,
    },
    select: {
      purpose: true,
      channel: true,
      status: true,
      sequence: true,
      basis: true,
      text_version: true,
      text_snapshot: true,
      evidence: true,
    },
  });

  const decision = canContact({
    purpose,
    channel,
    events: mapLedgerRows(events),
    processingRestricted: state != null && state.processing_status !== 'ACTIVE',
    transactionalProjection: {
      orderEmailConfirmed: customer.contact_email_ok,
    },
  });

  if (decision.allowed) {
    return { action: 'allow' };
  }
  return { action: 'block', reason: decision.reason, customerId };
}

export async function writeOutboxContactBlockAudit(
  tx: Prisma.TransactionClient,
  input: EnqueueNotificationInput,
  customerId: string,
  reason: ContactPermissionReason,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenant_id: input.tenantId,
      entity_type: 'NotificationOutbox',
      entity_id: `${input.eventType}:${input.occurrenceId}`,
      action: AuditLogAction.CREATE,
      actor_type: AuditActorType.SYSTEM,
      source: 'notification-outbox.contact-guard',
      after: {
        blocked: true,
        reason_code: reason,
        customer_id: customerId,
        consent_purpose: input.consentPurpose ?? null,
        channel: input.channel,
        event_type: input.eventType,
        occurrence_id: input.occurrenceId,
        recipient_key: input.recipientKey,
      },
    },
  });
}
