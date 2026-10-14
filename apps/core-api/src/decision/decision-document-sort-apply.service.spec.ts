import { DecisionDocumentSortApplier } from './decision-document-sort-apply.service.js';
import type { ProviderCall } from './decision-live-apply.types.js';

const TENANT_ID = 'tenant-1';
const ASSET_ID = 'asset-1';
const TRACE_ID = '2f1c2b5e-6a1f-4f5e-9d3a-0c1b2a3d4e5f';
const UNCLEAR_TEXT = 'Hallo Werkstatt, bitte Termin bestätigen.';

function answer(choice: string): ProviderCall {
  return {
    ok: true,
    suggestion: {
      choice,
      raw_ref: 'raw-1',
      latency_ms: 5,
      provider: 'openrouter-jev',
      model: 'typesafe/jev-1.13',
    },
  };
}

function buildApplier(options: { tier?: 'AUTO' | 'PROPOSE' | 'HUMAN_ONLY' }) {
  const prisma = {
    documentBrandAsset: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const shadow = {
    resolveTraceId: () => TRACE_ID,
    isShadowEnabled: jest.fn().mockReturnValue(false),
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
    resolveEffectiveMode: jest.fn().mockResolvedValue('live'),
  };
  const providerClient = {
    providerId: 'openrouter-jev',
    ask: jest.fn().mockResolvedValue(answer('Lieferschein')),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const applier = new DecisionDocumentSortApplier(
    prisma as never,
    shadow as never,
    policy as never,
    proposals as never,
    modes as never,
    providerClient as never,
    audit as never,
  );
  return { applier, prisma, policy, proposals, providerClient, audit };
}

const PARAMS = { tenantId: TENANT_ID, assetId: ASSET_ID, traceId: TRACE_ID };

describe('DecisionDocumentSortApplier', () => {
  it('does not ask the provider when the heuristic already decided the type', async () => {
    const { applier, providerClient, audit } = buildApplier({});

    await applier.apply({ ...PARAMS, text: 'Rechnung 2026-17' });

    expect(providerClient.ask).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('AUTO: writes the settled type to a READY asset that has no type yet', async () => {
    const { applier, prisma, audit } = buildApplier({ tier: 'AUTO' });

    await applier.apply({ ...PARAMS, text: UNCLEAR_TEXT });

    expect(prisma.documentBrandAsset.updateMany).toHaveBeenCalledWith({
      where: {
        id: ASSET_ID,
        tenant_id: TENANT_ID,
        state: 'READY',
        document_sort_type: null,
      },
      data: { document_sort_type: 'Lieferschein' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'applied', targetEntityId: ASSET_ID }),
    );
  });

  it('PROPOSE: queues the type as a pending action and leaves the asset untouched', async () => {
    const { applier, prisma, proposals, audit } = buildApplier({
      tier: 'PROPOSE',
    });

    await applier.apply({ ...PARAMS, text: UNCLEAR_TEXT });

    expect(prisma.documentBrandAsset.updateMany).not.toHaveBeenCalled();
    expect(proposals.persistPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: 'decision.document_sort',
        tier: 'PROPOSE',
        preview_json: {
          heuristic_type: 'Sonstiges',
          suggested_type: 'Lieferschein',
        },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'proposed' }),
    );
  });

  it('HUMAN_ONLY: neither writes nor queues, and records the refusal', async () => {
    const { applier, prisma, proposals, audit } = buildApplier({
      tier: 'HUMAN_ONLY',
    });

    await applier.apply({ ...PARAMS, text: UNCLEAR_TEXT });

    expect(prisma.documentBrandAsset.updateMany).not.toHaveBeenCalled();
    expect(proposals.persistPendingAction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'refused', reason: 'human_only' }),
    );
  });

  it('records a failed write as apply_failed and never throws', async () => {
    const { applier, prisma, audit } = buildApplier({ tier: 'AUTO' });
    prisma.documentBrandAsset.updateMany.mockRejectedValueOnce(
      new Error('connection lost'),
    );

    await expect(
      applier.apply({ ...PARAMS, text: UNCLEAR_TEXT }),
    ).resolves.toBeUndefined();

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'fallback', reason: 'apply_failed' }),
    );
  });
});
