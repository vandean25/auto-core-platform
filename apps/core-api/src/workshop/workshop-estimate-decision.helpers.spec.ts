import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { asFake } from '../invoices/invoice-fixtures.spec.support.js';
import {
  EstimateApprovalChannel,
  EstimateApprovalDecision,
  Prisma,
  WorkshopEstimateStatus,
} from '@prisma/client';
import {
  assertAmountQuoted,
  assertReactionFits,
  assertVersionDecidable,
  buildAdvisorApprovalData,
  decisionToVersionStatus,
  appendEstimateDecisionDomainEvent,
  resolveAdvisorDecidedAt,
} from './workshop-estimate-decision.helpers.js';

const NOW = new Date('2026-10-14T10:00:00.000Z');
const SENT_AT = new Date('2026-10-10T08:00:00.000Z');
const FUTURE = new Date('2026-10-24T08:00:00.000Z');
const PAST = new Date('2026-10-01T08:00:00.000Z');

function conflictCode(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    return (error as ConflictException).getResponse() as unknown as string;
  }
  throw new Error('expected a ConflictException');
}

describe('assertVersionDecidable', () => {
  it.each([
    [WorkshopEstimateStatus.DRAFT, 'ESTIMATE_VERSION_NOT_SENT'],
    [WorkshopEstimateStatus.SUPERSEDED, 'ESTIMATE_VERSION_SUPERSEDED'],
    [WorkshopEstimateStatus.EXPIRED, 'ESTIMATE_VERSION_EXPIRED'],
    [WorkshopEstimateStatus.APPROVED, 'ESTIMATE_VERSION_ALREADY_DECIDED'],
    [WorkshopEstimateStatus.DECLINED, 'ESTIMATE_VERSION_ALREADY_DECIDED'],
  ])('answers 409 for a %s version with its own code', (status, code) => {
    const response = conflictCode(() =>
      assertVersionDecidable({ status, valid_until: FUTURE }, NOW),
    ) as unknown as { code: string };
    expect(response.code).toBe(code);
  });

  it('refuses a sent version whose validity has passed', () => {
    const response = conflictCode(() =>
      assertVersionDecidable({ status: WorkshopEstimateStatus.SENT, valid_until: PAST }, NOW),
    ) as unknown as { code: string };
    expect(response.code).toBe('ESTIMATE_VERSION_EXPIRED');
  });

  it('accepts a sent version that is still valid', () => {
    expect(() =>
      assertVersionDecidable({ status: WorkshopEstimateStatus.SENT, valid_until: FUTURE }, NOW),
    ).not.toThrow();
  });
});

describe('assertAmountQuoted', () => {
  it('accepts the gross total of the sent version to the cent', () => {
    expect(() => assertAmountQuoted('192.00', new Prisma.Decimal('192.00'))).not.toThrow();
  });

  it('refuses another amount with 422 and the expected total', () => {
    try {
      assertAmountQuoted('180.00', new Prisma.Decimal('192.00'));
      throw new Error('expected a 422');
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'ESTIMATE_AMOUNT_MISMATCH',
        expected_amount_gross: '192.00',
      });
    }
  });

  it('refuses a version without a total', () => {
    const response = conflictCode(() => assertAmountQuoted('192.00', null)) as unknown as { code: string };
    expect(response.code).toBe('ESTIMATE_VERSION_NOT_DECIDABLE');
  });
});

describe('resolveAdvisorDecidedAt', () => {
  it('reads an explicit null as no time given, so the decision is recorded now', () => {
    expect(
      resolveAdvisorDecidedAt(
        null,
        new Date('2026-10-14T09:00:00.000Z'),
        NOW,
      ),
    ).toEqual(NOW);
  });

  it('defaults to now when the advisor gives no time', () => {
    expect(resolveAdvisorDecidedAt(undefined, SENT_AT, NOW)).toBe(NOW);
  });

  it('accepts a time from the call between sending and now', () => {
    const at = '2026-10-12T09:30:00.000Z';
    expect(resolveAdvisorDecidedAt(at, SENT_AT, NOW).toISOString()).toBe(at);
  });

  it.each([
    ['in the future', '2026-10-14T11:00:00.000Z'],
    ['before the version was sent', '2026-10-09T11:00:00.000Z'],
    ['not a date', 'not-a-date'],
  ])('refuses a time %s with 422', (_label, value) => {
    expect(() => resolveAdvisorDecidedAt(value, SENT_AT, NOW)).toThrow(UnprocessableEntityException);
  });
});

describe('buildAdvisorApprovalData', () => {
  const version = {
    snapshot_sha256: 'snapshot-sha',
    pdf_sha256: null,
    legal_text_version: 'kv-legal-de-v1',
    legal_text_sha256: 'legal-sha',
  };

  it('records the sent evidence and the advisor fields, and no IP address or user agent', () => {
    const data = buildAdvisorApprovalData({
      tenantId: 'tenant-1',
      versionId: 'version-1',
      version,
      decision: EstimateApprovalDecision.APPROVED,
      channel: EstimateApprovalChannel.PHONE,
      decidedAt: NOW,
      amountGross: '192.00',
      reaction: undefined,
      note: 'Telefonisch bestätigt',
      recordedByUserId: 'user-1',
    });

    expect(data).toMatchObject({
      tenant_id: 'tenant-1',
      workshop_estimate_version_id: 'version-1',
      channel: 'PHONE',
      decision: 'APPROVED',
      content_sha256: 'snapshot-sha',
      legal_text_sha256: 'legal-sha',
      legal_blocks_accepted: false,
      b2c_declaration_accepted: false,
      customer_reaction: null,
      recorded_by_user_id: 'user-1',
      note: 'Telefonisch bestätigt',
    });
    expect(data).not.toHaveProperty('ip_address');
    expect(data).not.toHaveProperty('user_agent');
    expect(data.amount_quoted_gross).toEqual(new Prisma.Decimal('192.00'));
  });

  it('refuses a version that has no sent snapshot to decide against', () => {
    expect(() =>
      buildAdvisorApprovalData({
        tenantId: 'tenant-1',
        versionId: 'version-1',
        version: { ...version, snapshot_sha256: null },
        decision: EstimateApprovalDecision.DECLINED,
        channel: EstimateApprovalChannel.EMAIL,
        decidedAt: NOW,
        amountGross: '192.00',
        reaction: undefined,
        note: 'Per E-Mail abgelehnt',
        recordedByUserId: 'user-1',
      }),
    ).toThrow(ConflictException);
  });
});

describe('assertReactionFits', () => {
  it('accepts no reaction, and null from a client that sends one', () => {
    expect(() =>
      assertReactionFits(EstimateApprovalDecision.APPROVED, undefined),
    ).not.toThrow();
    expect(() =>
      assertReactionFits(EstimateApprovalDecision.DECLINED, null),
    ).not.toThrow();
  });

  it('accepts the reactions that fit an approval', () => {
    expect(() =>
      assertReactionFits(EstimateApprovalDecision.APPROVED, 'AGREED'),
    ).not.toThrow();
    expect(() =>
      assertReactionFits(EstimateApprovalDecision.APPROVED, 'QUESTIONED'),
    ).not.toThrow();
  });

  it('accepts the reactions that fit a refusal', () => {
    for (const reaction of [
      'DECLINED',
      'QUESTIONED',
      'CALLBACK_REQUESTED',
    ] as const) {
      expect(() =>
        assertReactionFits(EstimateApprovalDecision.DECLINED, reaction),
      ).not.toThrow();
    }
  });

  it('refuses a reaction that contradicts the decision with 422 and its code', () => {
    let caught: unknown;
    try {
      assertReactionFits(EstimateApprovalDecision.APPROVED, 'DECLINED');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as UnprocessableEntityException).getResponse()).toMatchObject(
      { code: 'ESTIMATE_REACTION_MISMATCH' },
    );
  });

  it('refuses agreement on a refusal, and no response with any decision', () => {
    expect(() =>
      assertReactionFits(EstimateApprovalDecision.DECLINED, 'AGREED'),
    ).toThrow(UnprocessableEntityException);
    expect(() =>
      assertReactionFits(EstimateApprovalDecision.APPROVED, 'NO_RESPONSE'),
    ).toThrow(UnprocessableEntityException);
  });
});

describe('decisionToVersionStatus', () => {
  it('maps the decision to the version status it moves to', () => {
    expect(decisionToVersionStatus(EstimateApprovalDecision.APPROVED)).toBe(WorkshopEstimateStatus.APPROVED);
    expect(decisionToVersionStatus(EstimateApprovalDecision.DECLINED)).toBe(WorkshopEstimateStatus.DECLINED);
  });
});

describe('appendEstimateDecisionDomainEvent', () => {
  it('appends only the durable domain event in the caller transaction', async () => {
    const tx = asFake<Prisma.TransactionClient>({});
    const domainEventStore = {
      appendInTx: jest.fn().mockResolvedValue({ eventId: 'e1', sequence: BigInt(1) }),
    };

    await appendEstimateDecisionDomainEvent(tx, {
      tenantId: 'tenant-1',
      siteId: 'site-1',
      approvalId: 'approval-1',
      versionId: 'version-1',
      workshopOrderId: 'order-1',
      decision: EstimateApprovalDecision.APPROVED,
      decidedAt: new Date('2026-10-15T10:00:00.000Z'),
      traceId: '00000000-0000-4000-8000-000000000001',
      domainEventStore,
    });

    expect(domainEventStore.appendInTx).toHaveBeenCalled();
  });
});
