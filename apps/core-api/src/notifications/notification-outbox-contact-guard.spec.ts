import {
  AuditLogAction,
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
} from '@prisma/client';
import {
  evaluateOutboxContactPermission,
  requiresOutboxContactCheck,
  writeOutboxContactBlockAudit,
} from './notification-outbox-contact-guard.js';
import type { EnqueueNotificationInput } from './notification-outbox.rows.js';

const TENANT = 'tenant-1';
const CUSTOMER = 'customer-1';
const CONTROLLER = 'controller-1';

const baseCustomerEmailInput: EnqueueNotificationInput = {
  tenantId: TENANT,
  eventType: NotificationEventType.WORKSHOP_ORDER_READY,
  occurrenceId: 'occ-1',
  channel: NotificationChannel.EMAIL,
  recipientKind: NotificationRecipientKind.CUSTOMER,
  recipientKey: `customer:${CUSTOMER}`,
  consentPurpose: 'ORDER_COMMUNICATION',
  controllerLegalEntityId: CONTROLLER,
  email: {
    recipientEmail: 'consent-test@example.at',
    subject: 'Test',
    text: 'Hello',
    senderName: 'Shop',
    replyToEmail: 'shop@example.at',
  },
};

function makeTx(overrides: {
  customer?: { contact_email_ok: boolean } | null;
  events?: Array<Record<string, unknown>>;
  processingStatus?: 'ACTIVE' | 'RESTRICTED';
}) {
  return {
    legalEntity: {
      findFirst: jest.fn().mockResolvedValue({ id: CONTROLLER }),
    },
    workshopOrder: { findFirst: jest.fn() },
    customer: {
      findFirst: jest.fn().mockResolvedValue(overrides.customer ?? null),
    },
    customerCommunicationState: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.processingStatus
          ? { processing_status: overrides.processingStatus }
          : null,
      ),
    },
    customerConsent: {
      findMany: jest.fn().mockResolvedValue(overrides.events ?? []),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

describe('requiresOutboxContactCheck', () => {
  it('skips internal in-app advisor notices', () => {
    expect(
      requiresOutboxContactCheck({
        tenantId: TENANT,
        eventType: NotificationEventType.WORKSHOP_TASK_WAITING_CUSTOMER,
        occurrenceId: 'x',
        channel: NotificationChannel.IN_APP,
        recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
        recipientKey: 'advisors',
      }),
    ).toBe(false);
  });

  it('requires check for customer email rows', () => {
    expect(requiresOutboxContactCheck(baseCustomerEmailInput)).toBe(true);
  });

  it('skips consent for landing-demo magic link recipient keys', () => {
    expect(
      requiresOutboxContactCheck({
        tenantId: TENANT,
        eventType: NotificationEventType.LANDING_DEMO_MAGIC_LINK,
        occurrenceId: 'grant-1',
        channel: NotificationChannel.EMAIL,
        recipientKind: NotificationRecipientKind.CUSTOMER,
        recipientKey: 'landing-demo:consent-test@example.at',
      }),
    ).toBe(false);
  });
});

describe('evaluateOutboxContactPermission', () => {
  it('allows transactional email when contact_email_ok is true', async () => {
    const tx = makeTx({ customer: { contact_email_ok: true } });
    const result = await evaluateOutboxContactPermission(
      tx as never,
      baseCustomerEmailInput,
    );
    expect(result).toEqual({ action: 'allow' });
  });

  it('blocks marketing without consent', async () => {
    const tx = makeTx({ customer: { contact_email_ok: true } });
    const result = await evaluateOutboxContactPermission(tx as never, {
      ...baseCustomerEmailInput,
      consentPurpose: 'NEWSLETTER',
    });
    expect(result).toEqual({
      action: 'block',
      reason: 'MARKETING_PERMISSION_MISSING',
      customerId: CUSTOMER,
    });
  });

  it('blocks service reminder without consent', async () => {
    const tx = makeTx({ customer: { contact_email_ok: true } });
    const result = await evaluateOutboxContactPermission(tx as never, {
      ...baseCustomerEmailInput,
      consentPurpose: 'SERVICE_REMINDER',
    });
    expect(result).toEqual({
      action: 'block',
      reason: 'MARKETING_PERMISSION_MISSING',
      customerId: CUSTOMER,
    });
  });

  it('blocks immediately on opt-out (REVOKED)', async () => {
    const tx = makeTx({
      customer: { contact_email_ok: true },
      events: [
        {
          purpose: 'NEWSLETTER',
          channel: 'EMAIL',
          status: 'GRANTED',
          sequence: 1,
          basis: 'CONSENT',
          text_version: 'v1',
          text_snapshot: 'text',
        },
        {
          purpose: 'NEWSLETTER',
          channel: 'EMAIL',
          status: 'REVOKED',
          sequence: 2,
        },
      ],
    });
    const result = await evaluateOutboxContactPermission(tx as never, {
      ...baseCustomerEmailInput,
      consentPurpose: 'NEWSLETTER',
    });
    expect(result).toEqual({
      action: 'block',
      reason: 'CONTACT_WITHDRAWN',
      customerId: CUSTOMER,
    });
  });

  it('blocks when processing is restricted', async () => {
    const tx = makeTx({
      customer: { contact_email_ok: true },
      processingStatus: 'RESTRICTED',
    });
    const result = await evaluateOutboxContactPermission(
      tx as never,
      baseCustomerEmailInput,
    );
    expect(result).toEqual({
      action: 'block',
      reason: 'PROCESSING_RESTRICTED',
      customerId: CUSTOMER,
    });
  });
});

describe('writeOutboxContactBlockAudit', () => {
  it('writes an audit row with the reason code', async () => {
    const tx = makeTx({ customer: { contact_email_ok: false } });
    await writeOutboxContactBlockAudit(
      tx as never,
      baseCustomerEmailInput,
      CUSTOMER,
      'NO_CONTACT_POINT',
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: TENANT,
        entity_type: 'NotificationOutbox',
        action: AuditLogAction.CREATE,
        source: 'notification-outbox.contact-guard',
        after: expect.objectContaining({
          blocked: true,
          reason_code: 'NO_CONTACT_POINT',
          customer_id: CUSTOMER,
        }),
      }),
    });
  });
});
