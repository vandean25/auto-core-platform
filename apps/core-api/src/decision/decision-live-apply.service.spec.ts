import type { Customer } from '@prisma/client';
import type { DryRunRowResult } from '../import/import.types.js';
import { DecisionLiveApplyService } from './decision-live-apply.service.js';
import { DecisionUseCaseHooksService } from './decision-use-case-hooks.service.js';
import type { DecisionProvider } from './decision-provider.js';
import type { DecisionResult } from './decision.types.js';

const TENANT_ID = 'tenant-1';
const TRACE_ID = '2f1c2b5e-6a1f-4f5e-9d3a-0c1b2a3d4e5f';
const JOB_ID = 'job-1';
const CUSTOMER_ID = 'customer-1';
const ASSET_ID = 'asset-1';

const ORIGINAL_ENV = { ...process.env };

function customerRecord(): Customer {
  return {
    id: CUSTOMER_ID,
    tenant_id: TENANT_ID,
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Ada',
    last_name: 'Lovelace',
  } as Customer;
}

/** Ambiguous import row: same name as the stored customer, so IMPORT_POSSIBLE_DUPLICATE. */
function ambiguousRow(rowNo: number, overrides: Partial<DryRunRowResult> = {}) {
  return {
    row_no: rowNo,
    external_id: `external-${rowNo}`,
    action: 'CREATE',
    entity_id: null,
    errors: [],
    warnings: [{ code: 'IMPORT_POSSIBLE_DUPLICATE', message: 'Duplicate' }],
    normalized: {
      external_id: `external-${rowNo}`,
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.org',
      phone: null,
      vat_id: null,
      address_street: null,
      address_zip: null,
      address_city: null,
      address_country: 'AT',
    },
    ...overrides,
  };
}

function suggestion(choice: string): DecisionResult {
  return {
    choice,
    raw_ref: 'raw-1',
    latency_ms: 12,
    provider: 'openrouter-jev',
    model: 'typesafe/jev-1.13',
  };
}

type Harness = ReturnType<typeof buildHarness>;

function buildHarness(options: {
  tier: 'AUTO' | 'PROPOSE' | 'HUMAN_ONLY';
  decide?: jest.Mock;
  tenantMode?: string | null;
  shadowEnabled?: boolean;
}) {
  const prisma = {
    tenant: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ decision_apply_mode: options.tenantMode ?? null }),
    },
    customer: { findMany: jest.fn().mockResolvedValue([customerRecord()]) },
    importJobRow: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest
        .fn()
        .mockResolvedValue([{ action: 'UPDATE', _count: { _all: 1 } }]),
    },
    importJob: {
      findFirst: jest.fn().mockResolvedValue({
        totals_json: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    documentBrandAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const shadow = {
    resolveTraceId: () => TRACE_ID,
    isShadowEnabled: jest.fn().mockReturnValue(options.shadowEnabled ?? false),
    scheduleShadow: jest.fn(),
    writeShadowRecord: jest.fn().mockResolvedValue(undefined),
  };
  const decide = options.decide ?? jest.fn().mockResolvedValue(null);
  const provider = {
    providerId: 'openrouter-jev',
    decide,
  } as unknown as DecisionProvider;
  const policy = {
    evaluateAction: jest.fn().mockResolvedValue({
      tier: options.tier,
      reasons: [`base_tier_${options.tier.toLowerCase()}`],
      rule_id: 'rule-1',
      rule_version: 1,
    }),
  };
  const proposals = {
    persistPendingAction: jest.fn().mockResolvedValue({ id: 'proposal-1' }),
  };
  const actionLog = {
    record: jest.fn().mockResolvedValue({ id: 'log-1', traceId: TRACE_ID }),
  };
  const hooks = new DecisionUseCaseHooksService(
    shadow as never,
    prisma as never,
  );
  const service = new DecisionLiveApplyService(
    prisma as never,
    shadow as never,
    hooks,
    policy as never,
    proposals as never,
    actionLog as never,
    provider,
  );
  return { service, prisma, shadow, decide, policy, proposals, actionLog };
}

function importParams(rows: DryRunRowResult[]) {
  return {
    tenantId: TENANT_ID,
    traceId: TRACE_ID,
    jobId: JOB_ID,
    rows,
    totals: { rows: rows.length, create: rows.length, update: 0, skip: 0, error: 0 },
  };
}

function documentText(text: string) {
  return { tenantId: TENANT_ID, assetId: ASSET_ID, traceId: TRACE_ID, text };
}

describe('DecisionLiveApplyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', DECISION_APPLY_MODE: 'live' };
    delete process.env.DECISION_LIVE_OPT_IN;
    delete process.env.DECISION_SHADOW_ENABLED;
    delete process.env.DECISION_HTTP_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('mode resolution', () => {
    it('stays in shadow without touching the tenant row when the env is shadow', async () => {
      delete process.env.DECISION_APPLY_MODE;
      const { service, prisma, decide } = buildHarness({ tier: 'AUTO' });

      const result = await service.applyCustomerImportDecisions(
        importParams([ambiguousRow(1)]),
      );

      expect(result).toEqual({ mode: 'shadow' });
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
      expect(decide).not.toHaveBeenCalled();
    });

    it('lets a tenant opt out of live with decision_apply_mode=shadow', async () => {
      const { service, decide, prisma } = buildHarness({
        tier: 'AUTO',
        tenantMode: 'shadow',
      });

      const result = await service.applyCustomerImportDecisions(
        importParams([ambiguousRow(1)]),
      );

      expect(result).toEqual({ mode: 'shadow' });
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TENANT_ID } }),
      );
      expect(decide).not.toHaveBeenCalled();
    });

    it('forces shadow in a production runtime without DECISION_LIVE_OPT_IN', async () => {
      process.env.NODE_ENV = 'production';
      const { service, decide, prisma } = buildHarness({ tier: 'AUTO' });

      const result = await service.resolveEffectiveMode(TENANT_ID);

      expect(result).toBe('shadow');
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
      expect(decide).not.toHaveBeenCalled();
    });

    it('allows live in a production runtime only with DECISION_LIVE_OPT_IN=true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DECISION_LIVE_OPT_IN = 'true';
      const { service } = buildHarness({ tier: 'AUTO' });

      await expect(service.resolveEffectiveMode(TENANT_ID)).resolves.toBe(
        'live',
      );
    });

    it('falls back to shadow when the tenant lookup fails', async () => {
      const harness = buildHarness({ tier: 'AUTO' });
      harness.prisma.tenant.findUnique.mockRejectedValueOnce(
        new Error('connection reset'),
      );

      await expect(harness.service.resolveEffectiveMode(TENANT_ID)).resolves.toBe(
        'shadow',
      );
    });
  });

  describe('customer import matching', () => {
    it('AUTO: adopts the suggested customer, updates totals and logs the trace', async () => {
      const { service, prisma, decide, actionLog } = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('choice_1')),
      });

      const result = await service.applyCustomerImportDecisions(
        importParams([ambiguousRow(1)]),
      );

      expect(prisma.importJobRow.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          import_job_id: JOB_ID,
          row_no: 1,
          action: 'CREATE',
        },
        data: { action: 'UPDATE', entity_id: CUSTOMER_ID },
      });
      expect(prisma.importJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: TENANT_ID, id: JOB_ID, status: 'DRY_RUN_DONE' },
          data: { totals_json: { rows: 1, create: 0, update: 1, skip: 0, error: 0 } },
        }),
      );
      expect(result).toEqual({
        mode: 'live',
        totals: { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
      });
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: TRACE_ID,
          actionType: 'decision.import_row_match',
          tier: 'AUTO',
          status: 'EXECUTED',
          entityType: 'ImportJob',
          entityId: JOB_ID,
        }),
      );
      expect(decide).toHaveBeenCalledTimes(1);
    });

    it('sends only redacted input to the provider and never personal data', async () => {
      const decide = jest.fn().mockResolvedValue(suggestion('choice_1'));
      const { service, actionLog } = buildHarness({ tier: 'AUTO', decide });

      await service.applyCustomerImportDecisions(importParams([ambiguousRow(1)]));

      const sent = JSON.stringify(decide.mock.calls);
      expect(sent).not.toContain('Lovelace');
      expect(sent).not.toContain('Ada');
      expect(sent).not.toContain('example.org');
      expect(sent).toContain('choice_1');
      expect(JSON.stringify(actionLog.record.mock.calls)).not.toContain(
        'Lovelace',
      );
    });

    it('PROPOSE: writes nothing to the rows and creates a pending action', async () => {
      const { service, prisma, proposals, actionLog } = buildHarness({
        tier: 'PROPOSE',
        decide: jest.fn().mockResolvedValue(suggestion('choice_1')),
      });

      await service.applyCustomerImportDecisions(importParams([ambiguousRow(1)]));

      expect(prisma.importJobRow.updateMany).not.toHaveBeenCalled();
      expect(proposals.persistPendingAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: 'decision.import_row_match',
          tier: 'PROPOSE',
          trace_id: TRACE_ID,
          payload_json: {
            import_job_id: JOB_ID,
            row_no: 1,
            customer_id: CUSTOMER_ID,
          },
        }),
      );
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PROPOSED', tier: 'PROPOSE' }),
      );
    });

    it('HUMAN_ONLY: never applies or proposes, and logs the refusal', async () => {
      const { service, prisma, proposals, actionLog } = buildHarness({
        tier: 'HUMAN_ONLY',
        decide: jest.fn().mockResolvedValue(suggestion('choice_1')),
      });

      const result = await service.applyCustomerImportDecisions(
        importParams([ambiguousRow(1)]),
      );

      expect(prisma.importJobRow.updateMany).not.toHaveBeenCalled();
      expect(prisma.importJob.updateMany).not.toHaveBeenCalled();
      expect(proposals.persistPendingAction).not.toHaveBeenCalled();
      expect(result).toEqual({
        mode: 'live',
        totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
      });
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'REFUSED',
          resultSummary: expect.objectContaining({ reason: 'human_only' }),
        }),
      );
    });

    it('AUTO: a row that changed since the dry run is left alone and logged as a fallback', async () => {
      const harness = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('choice_1')),
      });
      harness.prisma.importJobRow.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await harness.service.applyCustomerImportDecisions(
        importParams([ambiguousRow(1)]),
      );

      expect(harness.prisma.importJob.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        mode: 'live',
        totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
      });
      expect(harness.actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'record_changed' }),
        }),
      );
    });

    it('falls back on timeout without changing the rows', async () => {
      process.env.DECISION_HTTP_TIMEOUT_MS = '20';
      const { service, prisma, actionLog } = buildHarness({
        tier: 'AUTO',
        decide: jest.fn(() => new Promise<never>(() => undefined)),
      });

      const result = await service.applyCustomerImportDecisions(
        importParams([ambiguousRow(1)]),
      );

      expect(prisma.importJobRow.updateMany).not.toHaveBeenCalled();
      expect(result.mode).toBe('live');
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'timeout' }),
        }),
      );
    });

    it('falls back when the provider throws, and logs no provider message', async () => {
      const { service, prisma, actionLog } = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockRejectedValue(new Error('upstream secret detail')),
      });

      await service.applyCustomerImportDecisions(importParams([ambiguousRow(1)]));

      expect(prisma.importJobRow.updateMany).not.toHaveBeenCalled();
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'provider_error' }),
        }),
      );
      expect(JSON.stringify(actionLog.record.mock.calls)).not.toContain(
        'upstream secret detail',
      );
    });

    it.each([
      ['a choice outside the allowed list', 'choice_99'],
      ['a free-text choice', 'Rechnung'],
    ])('falls back on %s', async (_label, choice) => {
      const { service, prisma, actionLog } = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion(choice)),
      });

      await service.applyCustomerImportDecisions(importParams([ambiguousRow(1)]));

      expect(prisma.importJobRow.updateMany).not.toHaveBeenCalled();
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'invalid_choice' }),
        }),
      );
    });

    it('keeps the rules outcome when the suggestion is create_new on a CREATE row', async () => {
      const { service, prisma, actionLog } = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('choice_2')),
      });

      await service.applyCustomerImportDecisions(importParams([ambiguousRow(1)]));

      expect(prisma.importJobRow.updateMany).not.toHaveBeenCalled();
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({
            reason: 'suggestion_matches_rules',
          }),
        }),
      );
    });

    it('does not adopt a same-file candidate, which has no customer id', async () => {
      const firstRow = ambiguousRow(1, {
        warnings: [],
        normalized: {
          ...ambiguousRow(1).normalized,
        },
      });
      const secondRow = ambiguousRow(2);
      // Candidates are [stored customer (choice_1), same-file row 1 (choice_2)].
      const { service, prisma, actionLog } = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('choice_2')),
      });

      await service.applyCustomerImportDecisions(
        importParams([firstRow, secondRow]),
      );

      expect(prisma.importJobRow.updateMany).not.toHaveBeenCalled();
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'not_applicable' }),
        }),
      );
    });

    it('loads only the calling tenant customers', async () => {
      const { service, prisma } = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('choice_1')),
      });

      await service.applyCustomerImportDecisions(importParams([ambiguousRow(1)]));

      expect(prisma.customer.findMany).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID },
      });
    });

    it('calls the provider once and reuses the suggestion for the shadow row', async () => {
      const decide = jest.fn().mockResolvedValue(suggestion('choice_1'));
      const { service, shadow } = buildHarness({
        tier: 'PROPOSE',
        decide,
        shadowEnabled: true,
      });

      await service.applyCustomerImportDecisions(importParams([ambiguousRow(1)]));

      expect(decide).toHaveBeenCalledTimes(1);
      expect(shadow.writeShadowRecord).toHaveBeenCalledWith(
        expect.objectContaining({ useCase: 'import_row_matching', tenantId: TENANT_ID }),
        expect.objectContaining({
          suggestion: expect.objectContaining({ choice: 'choice_1' }),
          error: null,
        }),
      );
    });

    it('never throws into the import when the audit write fails', async () => {
      const harness = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('choice_1')),
      });
      harness.actionLog.record.mockRejectedValueOnce(new Error('db down'));

      await expect(
        harness.service.applyCustomerImportDecisions(importParams([ambiguousRow(1)])),
      ).resolves.toEqual({
        mode: 'live',
        totals: { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
      });
    });
  });

  describe('document sort', () => {
    it('does not consult Jev when the heuristic already decided the type', async () => {
      const { service, decide, actionLog, prisma } = buildHarness({ tier: 'AUTO' });

      await service.applyDocumentSortForAsset(documentText('Rechnung 2026-17'));

      expect(decide).not.toHaveBeenCalled();
      expect(actionLog.record).not.toHaveBeenCalled();
      expect(prisma.documentBrandAsset.updateMany).not.toHaveBeenCalled();
    });

    it('AUTO: sets the document type on a READY asset and logs the trace', async () => {
      const { service, prisma, actionLog } = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('Lieferschein')),
      });

      await service.applyDocumentSortForAsset(documentText('Hallo Werkstatt'));

      expect(prisma.documentBrandAsset.updateMany).toHaveBeenCalledWith({
        where: {
          id: ASSET_ID,
          tenant_id: TENANT_ID,
          state: 'READY',
          document_sort_type: null,
        },
        data: { document_sort_type: 'Lieferschein' },
      });
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: TRACE_ID,
          actionType: 'decision.document_sort',
          tier: 'AUTO',
          status: 'EXECUTED',
          entityType: 'DocumentBrandAsset',
          entityId: ASSET_ID,
        }),
      );
    });

    it('AUTO: a second decision never overwrites a type that is already set', async () => {
      const harness = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('Lieferschein')),
      });
      harness.prisma.documentBrandAsset.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await harness.service.applyDocumentSortForAsset(documentText('Hallo'));

      expect(harness.actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'target_not_ready' }),
        }),
      );
    });

    it('PROPOSE: creates a pending action and leaves the asset untouched', async () => {
      const { service, prisma, proposals, actionLog } = buildHarness({
        tier: 'PROPOSE',
        decide: jest.fn().mockResolvedValue(suggestion('Kostenvoranschlag')),
      });

      await service.applyDocumentSortForAsset(documentText('Hallo'));

      expect(prisma.documentBrandAsset.updateMany).not.toHaveBeenCalled();
      expect(proposals.persistPendingAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: 'decision.document_sort',
          tier: 'PROPOSE',
          payload_json: {
            document_brand_asset_id: ASSET_ID,
            document_sort_type: 'Kostenvoranschlag',
          },
        }),
      );
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PROPOSED' }),
      );
    });

    it('HUMAN_ONLY: never applies or proposes', async () => {
      const { service, prisma, proposals, actionLog } = buildHarness({
        tier: 'HUMAN_ONLY',
        decide: jest.fn().mockResolvedValue(suggestion('Fahrzeugschein')),
      });

      await service.applyDocumentSortForAsset(documentText('Hallo'));

      expect(prisma.documentBrandAsset.updateMany).not.toHaveBeenCalled();
      expect(proposals.persistPendingAction).not.toHaveBeenCalled();
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'REFUSED',
          resultSummary: expect.objectContaining({ reason: 'human_only' }),
        }),
      );
    });

    it('falls back on a type outside the allowed list', async () => {
      const { service, prisma, actionLog } = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('Mietvertrag')),
      });

      await service.applyDocumentSortForAsset(documentText('Hallo'));

      expect(prisma.documentBrandAsset.updateMany).not.toHaveBeenCalled();
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'invalid_choice' }),
        }),
      );
    });

    it('falls back on timeout and keeps the heuristic Sonstiges', async () => {
      process.env.DECISION_HTTP_TIMEOUT_MS = '20';
      const { service, prisma, actionLog } = buildHarness({
        tier: 'AUTO',
        decide: jest.fn(() => new Promise<never>(() => undefined)),
      });

      await service.applyDocumentSortForAsset(documentText('Hallo'));

      expect(prisma.documentBrandAsset.updateMany).not.toHaveBeenCalled();
      expect(actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'timeout' }),
        }),
      );
    });

    it('does nothing in shadow mode', async () => {
      delete process.env.DECISION_APPLY_MODE;
      const { service, decide, actionLog } = buildHarness({ tier: 'AUTO' });

      await service.applyDocumentSortForAsset(documentText('Hallo'));

      expect(decide).not.toHaveBeenCalled();
      expect(actionLog.record).not.toHaveBeenCalled();
    });
  });
  describe('write failures stay audited and never escape', () => {
    it('AUTO: a job that left DRY_RUN_DONE during the Jev wait rolls the rows back and logs apply_failed', async () => {
      const harness = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('choice_1')),
      });
      harness.prisma.importJob.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await harness.service.applyCustomerImportDecisions(
        importParams([ambiguousRow(1)]),
      );

      expect(harness.prisma.importJobRow.updateMany).toHaveBeenCalled();
      expect(result).toEqual({
        mode: 'live',
        totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
      });
      expect(harness.actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'apply_failed' }),
        }),
      );
    });

    it('AUTO: a failed transaction changes nothing and logs apply_failed', async () => {
      const harness = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('choice_1')),
      });
      harness.prisma.importJobRow.updateMany.mockRejectedValueOnce(
        new Error('deadlock detected'),
      );

      const result = await harness.service.applyCustomerImportDecisions(
        importParams([ambiguousRow(1)]),
      );

      expect(harness.prisma.importJob.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        mode: 'live',
        totals: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
      });
      expect(harness.actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'apply_failed' }),
        }),
      );
    });

    it('PROPOSE: a failed proposal write is logged as a fallback, not a proposal', async () => {
      const harness = buildHarness({
        tier: 'PROPOSE',
        decide: jest.fn().mockResolvedValue(suggestion('choice_1')),
      });
      harness.proposals.persistPendingAction.mockRejectedValueOnce(
        new Error('insert failed'),
      );

      await harness.service.applyCustomerImportDecisions(
        importParams([ambiguousRow(1)]),
      );

      expect(harness.actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'apply_failed' }),
        }),
      );
    });

    it('document sort AUTO: a failed write is logged as a fallback and never throws', async () => {
      const harness = buildHarness({
        tier: 'AUTO',
        decide: jest.fn().mockResolvedValue(suggestion('Lieferschein')),
      });
      harness.prisma.documentBrandAsset.updateMany.mockRejectedValueOnce(
        new Error('connection lost'),
      );

      await expect(
        harness.service.applyDocumentSortForAsset(documentText('Hallo')),
      ).resolves.toBeUndefined();

      expect(harness.actionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FALLBACK',
          resultSummary: expect.objectContaining({ reason: 'apply_failed' }),
        }),
      );
    });
  });
});
