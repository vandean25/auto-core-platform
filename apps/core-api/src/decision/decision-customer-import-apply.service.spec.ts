import { ImportRowAction } from '@prisma/client';
import type {
  DryRunRowResult,
  ImportJobTotals,
} from '../import/import.types.js';
import { DecisionCustomerImportApplier } from './decision-customer-import-apply.service.js';
import type { DecisionResult } from './decision.types.js';
import type { ProviderCall } from './decision-live-apply.types.js';
import type { ImportRowMatchingCase } from './decision-use-case-hooks.service.js';

const TENANT_ID = 'tenant-1';
const JOB_ID = 'job-1';
const TRACE_ID = '2f1c2b5e-6a1f-4f5e-9d3a-0c1b2a3d4e5f';
const CREATE_NEW = 'create_new';
const TOTALS: ImportJobTotals = {
  rows: 2,
  create: 2,
  update: 0,
  skip: 0,
  error: 0,
};

function matchingCase(rowNo: number): ImportRowMatchingCase {
  return {
    row: { row_no: rowNo, action: ImportRowAction.CREATE } as DryRunRowResult,
    input: { row: { type: 'PRIVATE', match_features: [] }, candidates: [] },
    choices: ['customer-1', CREATE_NEW],
    candidateTargets: [{ choice: 'customer-1', entityId: 'customer-1' }],
    createChoice: CREATE_NEW,
    actualChoice: CREATE_NEW,
  };
}

const SUGGESTION: DecisionResult = {
  choice: 'choice_1',
  raw_ref: 'raw-1',
  latency_ms: 5,
  provider: 'openrouter-jev',
  model: 'typesafe/jev-1.13',
};
const MATCHED: ProviderCall = { ok: true, suggestion: SUGGESTION };

function buildApplier(options: {
  mode?: 'live' | 'shadow';
  cases?: ImportRowMatchingCase[];
  tier?: 'AUTO' | 'PROPOSE' | 'HUMAN_ONLY';
}) {
  const prisma = {
    importJobRow: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest
        .fn()
        .mockResolvedValue([{ action: 'UPDATE', _count: { _all: 1 } }]),
    },
    importJob: {
      findFirst: jest.fn().mockResolvedValue({ totals_json: TOTALS }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(
      async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(prisma),
    ),
  };
  const shadow = {
    resolveTraceId: () => TRACE_ID,
    isShadowEnabled: jest.fn().mockReturnValue(false),
  };
  const hooks = {
    buildCustomerImportMatchingCases: jest
      .fn()
      .mockResolvedValue(options.cases ?? [matchingCase(1), matchingCase(2)]),
  };
  const policy = {
    evaluateAction: jest.fn().mockResolvedValue({
      tier: options.tier ?? 'AUTO',
      reasons: ['base_tier_auto'],
    }),
  };
  const proposals = {
    persistPendingAction: jest.fn().mockResolvedValue({ id: 'proposal-1' }),
  };
  const modes = {
    resolveEffectiveMode: jest.fn().mockResolvedValue(options.mode ?? 'live'),
    isLiveForTenant: jest.fn(),
  };
  const providerClient = {
    providerId: 'openrouter-jev',
    ask: jest.fn().mockResolvedValue(MATCHED),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const applier = new DecisionCustomerImportApplier(
    prisma as never,
    shadow as never,
    hooks as never,
    policy as never,
    proposals as never,
    modes as never,
    providerClient as never,
    audit as never,
  );
  return { applier, prisma, hooks, policy, proposals, providerClient, audit };
}

function params(rows: DryRunRowResult[] = []) {
  return {
    tenantId: TENANT_ID,
    traceId: TRACE_ID,
    jobId: JOB_ID,
    rows,
    totals: TOTALS,
  };
}

describe('DecisionCustomerImportApplier', () => {
  it('stays in shadow without the policy, the matching or the provider when the tenant is in shadow', async () => {
    const { applier, hooks, policy, providerClient } = buildApplier({
      mode: 'shadow',
    });

    await expect(applier.apply(params())).resolves.toEqual({ mode: 'shadow' });
    expect(hooks.buildCustomerImportMatchingCases).not.toHaveBeenCalled();
    expect(policy.evaluateAction).not.toHaveBeenCalled();
    expect(providerClient.ask).not.toHaveBeenCalled();
  });

  it('returns the rules totals without evaluating the policy when no row has a matching case', async () => {
    const { applier, policy, audit } = buildApplier({ cases: [] });

    await expect(applier.apply(params())).resolves.toEqual({
      mode: 'live',
      totals: TOTALS,
    });
    expect(policy.evaluateAction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('asks the provider once per matching row and records one decision per row', async () => {
    const { applier, providerClient, audit } = buildApplier({
      tier: 'PROPOSE',
    });

    await applier.apply(params());

    expect(providerClient.ask).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('AUTO: writes the matches in one transaction and records them as applied', async () => {
    const { applier, prisma, audit } = buildApplier({
      tier: 'AUTO',
      cases: [matchingCase(1)],
    });

    const result = await applier.apply(params());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.importJobRow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { action: 'UPDATE', entity_id: 'customer-1' },
      }),
    );
    expect(result).toEqual({
      mode: 'live',
      totals: { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'applied',
        targetEntityId: 'customer-1',
      }),
    );
  });

  it('PROPOSE: opens no transaction and queues one pending action per match', async () => {
    const { applier, prisma, proposals } = buildApplier({ tier: 'PROPOSE' });

    await applier.apply(params());

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(proposals.persistPendingAction).toHaveBeenCalledTimes(2);
    expect(proposals.persistPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: 'decision.import_row_match',
        trace_id: TRACE_ID,
        tier: 'PROPOSE',
      }),
    );
  });

  it('records a provider answer that is not adoptable as a fallback and writes nothing', async () => {
    const { applier, prisma, providerClient, audit } = buildApplier({
      tier: 'AUTO',
      cases: [matchingCase(1)],
    });
    providerClient.ask.mockResolvedValueOnce({
      ok: true,
      suggestion: { ...SUGGESTION, choice: 'choice_2' },
    });

    await applier.apply(params());

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'fallback',
        reason: 'suggestion_matches_rules',
      }),
    );
  });
});
