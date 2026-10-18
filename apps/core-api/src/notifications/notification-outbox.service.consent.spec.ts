import {
  AuditLogAction,
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
} from '@prisma/client';
import { NotificationOutboxService } from './notification-outbox.service.js';
import type { EnqueueNotificationInput } from './notification-outbox.rows.js';

const customerEmailInput: EnqueueNotificationInput = {
  tenantId: 'tenant-1',
  eventType: NotificationEventType.WORKSHOP_ORDER_READY,
  occurrenceId: 'occ-1',
  channel: NotificationChannel.EMAIL,
  recipientKind: NotificationRecipientKind.CUSTOMER,
  recipientKey: 'customer:customer-1',
  consentPurpose: 'ORDER_COMMUNICATION',
  controllerLegalEntityId: 'controller-1',
  email: {
    recipientEmail: 'consent-test@example.at',
    subject: 'Ready',
    text: 'Your vehicle is ready.',
    senderName: 'Shop',
    replyToEmail: 'shop@example.at',
  },
};

function makeTx(overrides: { contactEmailOk?: boolean; events?: unknown[] }) {
  return {
    legalEntity: {
      findFirst: jest.fn().mockResolvedValue({ id: 'controller-1' }),
    },
    workshopOrder: { findFirst: jest.fn() },
    customer: {
      findFirst: jest.fn().mockResolvedValue({
        contact_email_ok: overrides.contactEmailOk ?? true,
      }),
    },
    customerCommunicationState: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    customerConsent: {
      findMany: jest.fn().mockResolvedValue(overrides.events ?? []),
    },
    notificationOutbox: {
      createMany: jest.fn(),
      findFirst: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

describe('NotificationOutboxService consent guard (AUT-610)', () => {
  const marketingUnsubscribe = {
    mintTokenForMarketingMessage: jest.fn(),
    buildUnsubscribePostUrl: jest.fn(),
  };
  const service = new NotificationOutboxService(
    marketingUnsubscribe as never,
  );

  it('returns blocked without writing an outbox row when consent is denied', async () => {
    const tx = makeTx({ contactEmailOk: false });

    const result = await service.enqueueInTx(tx as never, customerEmailInput);

    expect(result).toEqual({
      blocked: true,
      reason: 'NO_CONTACT_POINT',
    });
    expect(tx.notificationOutbox.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AuditLogAction.CREATE,
        after: expect.objectContaining({
          blocked: true,
          reason_code: 'NO_CONTACT_POINT',
        }),
      }),
    });
  });

  it('enqueues when transactional consent allows contact', async () => {
    const tx = makeTx({ contactEmailOk: true });
    tx.notificationOutbox.createMany.mockResolvedValue({ count: 1 });

    const result = await service.enqueueInTx(tx as never, customerEmailInput);

    expect(result.blocked).toBe(false);
    if (!result.blocked) {
      expect(result.created).toBe(true);
    }
    expect(tx.notificationOutbox.createMany).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
