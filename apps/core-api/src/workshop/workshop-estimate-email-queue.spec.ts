import { Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
  WorkshopEstimateStatus,
} from '@prisma/client';
import { hashApprovalToken } from './workshop-estimate-approval-token.helpers.js';
import {
  type EstimateEmailInput,
  invalidateSupersededApprovalTokens,
  queueEstimateEmailInTx,
  wakeUpAfterCommit,
} from './workshop-estimate-email-queue.js';

const ISSUED_AT = new Date('2026-10-13T10:00:00Z');
// 27 October 2026 is winter time, so 09:00 UTC is the cut-off instant.
const VALID_UNTIL = new Date('2026-10-27T09:00:00Z');

const INPUT: EstimateEmailInput = {
  tenantId: 'tenant-1',
  versionId: 'version-1',
  workshopOrderId: 'order-1',
  controllerLegalEntityId: 'controller-1',
  vehicle: { make: 'VW', model: 'Golf' },
  customer: {
    id: 'customer-1',
    contact_email_ok: true,
    email: 'max.muster@example.at',
  } as EstimateEmailInput['customer'],
  sellerName: 'Werkstatt Muster',
  estimateNumber: 'KV-2026-0001',
  approvalBaseUrl: 'https://portal.example.at',
  validUntil: VALID_UNTIL,
  issuedAt: ISSUED_AT,
};

function makeTx() {
  return {
    tenant: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ default_locale: 'de' as const }),
    },
    workshopEstimateApprovalToken: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('workshop estimate email queue (ADR-0025 §6 and §7)', () => {
  it('stores only the hash of the token and queues the estimate email with the link', async () => {
    const tx = makeTx();
    const outbox = {
      enqueueInTx: jest
        .fn()
        .mockResolvedValue({ blocked: false, id: 'outbox-1', created: true }),
    };

    const id = await queueEstimateEmailInTx(tx as never, outbox, INPUT);

    expect(id).toBe('outbox-1');
    const tokenWrite = tx.workshopEstimateApprovalToken.create.mock.calls[0][0]
      .data as { token_sha256: string };
    expect(tokenWrite).toMatchObject({
      tenant_id: 'tenant-1',
      workshop_estimate_version_id: 'version-1',
      expires_at: VALID_UNTIL,
    });
    expect(tokenWrite.token_sha256).toMatch(/^[0-9a-f]{64}$/);

    const [, row, now] = outbox.enqueueInTx.mock.calls[0];
    expect(now).toBe(ISSUED_AT);
    expect(row).toMatchObject({
      tenantId: 'tenant-1',
      eventType: NotificationEventType.CUSTOMER_ESTIMATE_SENT,
      channel: NotificationChannel.EMAIL,
      recipientKind: NotificationRecipientKind.CUSTOMER,
      recipientKey: 'customer:customer-1',
      occurrenceId: 'version-1',
      workshopOrderId: 'order-1',
      payload: { customer_id: 'customer-1' },
      consentPurpose: 'ORDER_COMMUNICATION',
      controllerLegalEntityId: 'controller-1',
    });
    // The link carries the raw token, and the database holds the hash of that same token.
    const raw = /\/approve\/([A-Za-z0-9_-]{43})/.exec(row.email.text)?.[1];
    expect(raw).toBeDefined();
    expect(hashApprovalToken(raw as string)).toBe(tokenWrite.token_sha256);
    expect(JSON.stringify(tokenWrite)).not.toContain(raw);
  });

  it('freezes document_locale en on the queued email when preferred_language is en', async () => {
    const tx = makeTx();
    const outbox = {
      enqueueInTx: jest
        .fn()
        .mockResolvedValue({ blocked: false, id: 'outbox-1', created: true }),
    };

    await queueEstimateEmailInTx(tx as never, outbox, {
      ...INPUT,
      customer: {
        ...INPUT.customer,
        preferred_language: 'en',
      },
    });

    const row = outbox.enqueueInTx.mock.calls[0][1];
    expect(row.email.documentLocale).toBe('en');
    expect(row.email.subject).toMatch(/^Estimate /);
  });

  it('writes nothing when the customer has not confirmed the address', async () => {
    const tx = makeTx();
    const outbox = { enqueueInTx: jest.fn() };

    await expect(
      queueEstimateEmailInTx(tx as never, outbox, {
        ...INPUT,
        customer: {
          ...INPUT.customer,
          contact_email_ok: false,
        },
      }),
    ).rejects.toThrow();
    expect(tx.workshopEstimateApprovalToken.create).not.toHaveBeenCalled();
    expect(outbox.enqueueInTx).not.toHaveBeenCalled();
  });

  it('invalidates the approval links of the superseded versions of the estimate', async () => {
    const tx = makeTx();

    await invalidateSupersededApprovalTokens(
      tx as never,
      'tenant-1',
      'estimate-1',
      ISSUED_AT,
    );

    expect(tx.workshopEstimateApprovalToken.updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        invalidated_at: null,
        consumed_at: null,
        version: {
          estimate_id: 'estimate-1',
          status: WorkshopEstimateStatus.SUPERSEDED,
        },
      },
      data: { invalidated_at: ISSUED_AT },
    });
  });

  it('wakes the committed row for its tenant', async () => {
    const wakeUps = { enqueueWakeUp: jest.fn().mockResolvedValue(undefined) };

    await wakeUpAfterCommit(wakeUps as never, 'outbox-1', 'tenant-1');

    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      outboxId: 'outbox-1',
      tenantId: 'tenant-1',
    });
  });

  it('logs a failed wake-up instead of failing the send', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const wakeUps = {
      enqueueWakeUp: jest.fn().mockRejectedValue(new Error('queue disabled')),
    };

    await expect(
      wakeUpAfterCommit(wakeUps as never, 'outbox-1', 'tenant-1'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('outbox-1'));
    warn.mockRestore();
  });
});
