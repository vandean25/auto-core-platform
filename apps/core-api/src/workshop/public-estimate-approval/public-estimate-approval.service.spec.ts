import {
  ConflictException,
  GoneException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { WorkshopEstimateSnapshot } from '../workshop-estimate-snapshot.js';
import type { RequestContextService } from '../../common/services/request-context.service.js';
import { asFake } from '../../invoices/invoice-fixtures.spec.support.js';
import {
  PublicEstimateDecision,
  type PublicEstimateDecisionDto,
} from './public-estimate-approval.dto.js';
import { PublicEstimateApprovalRateLimiter } from './public-estimate-approval.rate-limit.js';
import { PublicEstimateApprovalService } from './public-estimate-approval.service.js';

const TOKEN = 'A'.repeat(43);
const NOW = new Date('2026-10-20T10:00:00.000Z');
const VALID_UNTIL = new Date('2026-10-28T08:00:00.000Z');
const REQUEST = {
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (test)',
  acceptLanguage: 'de-AT,de;q=0.9',
};

function snapshotFixture(): WorkshopEstimateSnapshot {
  return {
    schema_version: 1,
    document: {
      kind: 'WORKSHOP_ESTIMATE',
      title: 'Kostenvoranschlag',
      estimate_number: 'KV-2026-0001',
      version: 1,
      issued_at: '2026-10-14T08:00:00.000Z',
      valid_from: '2026-10-14T08:00:00.000Z',
      valid_until: '2026-10-28T08:00:00.000Z',
      validity_days: 14,
      non_binding: true,
      free_of_charge: true,
      price_display: 'GROSS',
    },
    seller: { name: 'Werkstatt Muster GmbH', country_iso: 'AT' } as never,
    customer: {
      type: 'PRIVATE',
      first_name: 'Max',
      last_name: 'Mustermann',
      email: 'max.mustermann@example.at',
    } as never,
    vehicle: { make: 'VW', model: 'Golf', vin: null, plate: null, year: null },
    order: { order_number: 'WO-2026-0042', odometer: 120000 },
    lines: [],
    totals: {
      total_net: '0.00',
      total_tax: '0.00',
      total_gross: '0.00',
      tax_breakdown: [],
    },
    branding: {} as never,
    legal: {
      text_version: 'kv-legal-de-v1',
      text_sha256: 'legal-sha',
      paragraphs: ['Unverbindlich.'],
    },
  };
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'token-1',
    tenant_id: 'tenant-1',
    workshop_estimate_version_id: 'version-1',
    expires_at: VALID_UNTIL,
    invalidated_at: null,
    consumed_at: null,
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    status: 'SENT',
    total_gross: '192.00',
    estimate: { workshop_order_id: 'order-1', site_id: 'site-1' },
    valid_until: VALID_UNTIL,
    snapshot: snapshotFixture(),
    snapshot_sha256: 'snapshot-sha',
    pdf_sha256: 'pdf-sha',
    legal_text_version: 'kv-legal-de-v1',
    legal_text_sha256: 'legal-sha',
    ...overrides,
  };
}

function build() {
  const tx = {
    workshopEstimateApprovalToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workshopEstimateVersion: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workshopEstimateApproval: {
      create: jest.fn().mockResolvedValue({ id: 'approval-1' }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    workshopEstimateVersion: {
      findFirst: jest.fn().mockResolvedValue(versionRow()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const lookup = {
    findByTokenHash: jest.fn().mockResolvedValue(tokenRow()),
  };
  const tenantContext = { setPublicEstimateApprovalTenant: jest.fn() };
  const audit = { recordTenantMutation: jest.fn().mockResolvedValue(undefined) };
  const domainEventStore = {
    appendInTx: jest.fn().mockResolvedValue({ eventId: 'event-1', sequence: BigInt(1) }),
  };
  const estimateDecidedConsumer = {
    processTenantBatch: jest.fn().mockResolvedValue(1),
  };
  const estimateDecidedConsumerWakeUps = {
    isEnabled: jest.fn().mockReturnValue(false),
    enqueueWakeUp: jest.fn(),
  };
  const requestContext = asFake<RequestContextService>({
    getTraceId: jest.fn().mockReturnValue('trace-approval-1'),
  });
  const service = new PublicEstimateApprovalService(
    lookup as never,
    tenantContext as never,
    prisma as never,
    new PublicEstimateApprovalRateLimiter(),
    audit as never,
    domainEventStore,
    requestContext,
    estimateDecidedConsumer as never,
    estimateDecidedConsumerWakeUps as never,
  );
  return {
    service,
    tx,
    prisma,
    lookup,
    tenantContext,
    audit,
    domainEventStore,
    requestContext,
    estimateDecidedConsumer,
  };
}

function approval(overrides: Partial<PublicEstimateDecisionDto> = {}) {
  return {
    decision: PublicEstimateDecision.APPROVE,
    typed_full_name: '  Max Mustermann  ',
    legal_blocks_accepted: true,
    b2c_declaration_accepted: true,
    ...overrides,
  } as PublicEstimateDecisionDto;
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (error: unknown) => error,
  );
}

describe('PublicEstimateApprovalService.read', () => {
  it('returns the projection and writes nothing for a decidable link', async () => {
    const { service, prisma, tenantContext, tx } = build();

    const view = await service.read(TOKEN, NOW);

    expect(view.document.estimate_number).toBe('KV-2026-0001');
    expect(tenantContext.setPublicEstimateApprovalTenant).toHaveBeenCalledWith(
      'tenant-1',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.workshopEstimateApproval.create).not.toHaveBeenCalled();
    expect(prisma.workshopEstimateVersion.updateMany).not.toHaveBeenCalled();
  });

  it('answers not found without a database read for a malformed token', async () => {
    const { service, lookup } = build();

    await expect(service.read('short', NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(lookup.findByTokenHash).not.toHaveBeenCalled();
  });

  it('answers not found for an unknown token', async () => {
    const { service, lookup } = build();
    lookup.findByTokenHash.mockResolvedValue(null);

    await expect(service.read(TOKEN, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['used', { consumed_at: NOW }],
    ['invalidated by a newer send', { invalidated_at: NOW }],
    [
      'expired by its validity',
      { expires_at: new Date('2026-10-19T00:00:00Z') },
    ],
  ])('answers gone for a %s link', async (_label, overrides) => {
    const { service, lookup } = build();
    lookup.findByTokenHash.mockResolvedValue(tokenRow(overrides));

    await expect(service.read(TOKEN, NOW)).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it.each(['SUPERSEDED', 'EXPIRED'])(
    'answers gone when the version is %s',
    async (status) => {
      const { service, prisma } = build();
      prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
        versionRow({ status }),
      );

      await expect(service.read(TOKEN, NOW)).rejects.toBeInstanceOf(
        GoneException,
      );
    },
  );

  it('answers conflict when the version is already decided by another route', async () => {
    const { service, prisma } = build();
    prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
      versionRow({ status: 'APPROVED' }),
    );

    await expect(service.read(TOKEN, NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('marks a sent version past its validity as expired, and answers gone', async () => {
    const { service, prisma, lookup } = build();
    // The token expires with the version. A check of the token first would answer gone without marking the version.
    lookup.findByTokenHash.mockResolvedValue(
      tokenRow({ expires_at: new Date('2026-10-19T00:00:00Z') }),
    );
    prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
      versionRow({ valid_until: new Date('2026-10-19T00:00:00Z') }),
    );

    await expect(service.read(TOKEN, NOW)).rejects.toBeInstanceOf(
      GoneException,
    );
    expect(prisma.workshopEstimateVersion.updateMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', id: 'version-1', status: 'SENT' },
      data: { status: 'EXPIRED' },
    });
  });

  it('rate limits repeated reads of one link with a 429', async () => {
    const { service } = build();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await service.read(TOKEN, NOW);
    }

    const error = await failureOf(service.read(TOKEN, NOW));

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });
});

describe('PublicEstimateApprovalService.decide', () => {
  it('approves: consumes the token, moves the version and writes the evidence in one transaction', async () => {
    const { service, tx } = build();

    const result = await service.decide(TOKEN, approval(), REQUEST, NOW);

    expect(result).toEqual({
      decision: 'APPROVED',
      decided_at: NOW.toISOString(),
    });
    expect(tx.workshopEstimateApprovalToken.updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        id: 'token-1',
        consumed_at: null,
        invalidated_at: null,
        expires_at: { gt: NOW },
      },
      data: { consumed_at: NOW },
    });
    expect(tx.workshopEstimateVersion.updateMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', id: 'version-1', status: 'SENT' },
      data: { status: 'APPROVED' },
    });
    expect(tx.workshopEstimateApproval.create).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        workshop_estimate_version_id: 'version-1',
        approval_token_id: 'token-1',
        channel: 'LINK',
        decision: 'APPROVED',
        decided_at: NOW,
        content_sha256: 'snapshot-sha',
        pdf_sha256: 'pdf-sha',
        legal_text_version: 'kv-legal-de-v1',
        legal_text_sha256: 'legal-sha',
        recipient_email: 'max.mustermann@example.at',
        typed_full_name: 'Max Mustermann',
        legal_blocks_accepted: true,
        b2c_declaration_accepted: true,
        ip_address: '203.0.113.7',
        user_agent: 'Mozilla/5.0 (test)',
        accept_language: 'de-AT,de;q=0.9',
        amount_quoted_gross: '192.00',
      },
      select: { id: true },
    });
  });

  it('declines without the confirmations and records no typed name', async () => {
    const { service, tx } = build();

    await service.decide(
      TOKEN,
      approval({
        decision: PublicEstimateDecision.DECLINE,
        typed_full_name: undefined,
        legal_blocks_accepted: false,
        b2c_declaration_accepted: false,
      }),
      REQUEST,
      NOW,
    );

    expect(tx.workshopEstimateVersion.updateMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', id: 'version-1', status: 'SENT' },
      data: { status: 'DECLINED' },
    });
    expect(tx.workshopEstimateApproval.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        decision: 'DECLINED',
        typed_full_name: null,
        legal_blocks_accepted: false,
        b2c_declaration_accepted: false,
      }),
      select: { id: true },
    });
  });

  it('writes an audit row as the system and runs the estimate-decided consumer after commit', async () => {
    const {
      service,
      audit,
      tx,
      domainEventStore,
      requestContext,
      estimateDecidedConsumer,
    } = build();

    await service.decide(TOKEN, approval(), REQUEST, NOW);

    expect(requestContext.getTraceId).toHaveBeenCalled();
    expect(domainEventStore.appendInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: 'tenant-1',
        siteId: 'site-1',
        entityId: 'order-1',
        traceId: 'trace-approval-1',
      }),
    );
    expect(audit.recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'WorkshopEstimateApproval',
        entityId: 'approval-1',
        action: 'CREATE',
        actorType: 'SYSTEM',
      }),
      tx,
    );
    expect(estimateDecidedConsumer.processTenantBatch).toHaveBeenCalledWith(
      'tenant-1',
      NOW,
    );
  });

  it('still returns the committed decision when the post-commit consumer batch fails', async () => {
    const { service, estimateDecidedConsumer } = build();
    estimateDecidedConsumer.processTenantBatch.mockRejectedValue(
      new Error('consumer database error'),
    );

    const result = await service.decide(TOKEN, approval(), REQUEST, NOW);

    expect(result).toEqual({
      decision: 'APPROVED',
      decided_at: NOW.toISOString(),
    });
  });

  it('allows a later consumer batch after an inline failure', async () => {
    const { service, estimateDecidedConsumer } = build();
    estimateDecidedConsumer.processTenantBatch
      .mockRejectedValueOnce(new Error('transient consumer error'))
      .mockResolvedValueOnce(1);

    await service.decide(TOKEN, approval(), REQUEST, NOW);
    await estimateDecidedConsumer.processTenantBatch('tenant-1', NOW);

    expect(estimateDecidedConsumer.processTenantBatch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no legal confirmation', { legal_blocks_accepted: false }],
    ['no B2C declaration', { b2c_declaration_accepted: false }],
    ['no typed name', { typed_full_name: ' ' }],
  ])(
    'refuses an approval with %s before reading anything',
    async (_label, overrides) => {
      const { service, lookup, prisma } = build();

      await expect(
        service.decide(TOKEN, approval(overrides), REQUEST, NOW),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(lookup.findByTokenHash).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('answers gone and writes no evidence when the token was consumed in the meantime', async () => {
    const { service, tx } = build();
    tx.workshopEstimateApprovalToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.decide(TOKEN, approval(), REQUEST, NOW),
    ).rejects.toBeInstanceOf(GoneException);
    expect(tx.workshopEstimateVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.workshopEstimateApproval.create).not.toHaveBeenCalled();
  });

  it('answers conflict and writes no evidence when the version is no longer SENT', async () => {
    const { service, tx } = build();
    tx.workshopEstimateVersion.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.decide(TOKEN, approval(), REQUEST, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.workshopEstimateApproval.create).not.toHaveBeenCalled();
  });

  it('refuses a version without its frozen hashes before any write', async () => {
    const { service, prisma, tx } = build();
    prisma.workshopEstimateVersion.findFirst.mockResolvedValue(
      versionRow({ snapshot_sha256: null }),
    );

    await expect(
      service.decide(TOKEN, approval(), REQUEST, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.workshopEstimateApprovalToken.updateMany).not.toHaveBeenCalled();
  });

  it('truncates the request evidence to the column sizes', async () => {
    const { service, tx } = build();

    await service.decide(
      TOKEN,
      approval(),
      {
        ip: '198.51.100.1',
        userAgent: 'u'.repeat(900),
        acceptLanguage: 'l'.repeat(400),
      },
      NOW,
    );

    const data = tx.workshopEstimateApproval.create.mock.calls[0][0].data;
    expect(data.user_agent).toHaveLength(512);
    expect(data.accept_language).toHaveLength(200);
  });

  it('shares the decision budget per link and answers 429 past it', async () => {
    const { service } = build();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await service
        .decide(TOKEN, approval(), REQUEST, NOW)
        .catch(() => undefined);
    }

    const error = await failureOf(
      service.decide(TOKEN, approval(), REQUEST, NOW),
    );

    expect((error as HttpException).getStatus()).toBe(429);
  });
});
