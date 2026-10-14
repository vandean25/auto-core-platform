import {
  buildDocumentSortLiveDecision,
  gateDocumentSortSuggestion,
  type DocumentSortDecisionInput,
} from './decision-live-document-sort.outcome.js';
import type { ProviderCall } from './decision-live-apply.types.js';

function suggested(choice: string): ProviderCall {
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

function decisionInput(
  overrides: Partial<DocumentSortDecisionInput> = {},
): DocumentSortDecisionInput {
  return {
    tenantId: 'tenant-1',
    traceId: 'trace-1',
    assetId: 'asset-1',
    tier: 'AUTO',
    policyReasons: ['base_tier_auto'],
    write: { outcome: 'applied', reason: null },
    providerCall: suggested('Lieferschein'),
    providerId: 'openrouter-jev',
    redactedInput: { signals: [], text_excerpt_length: 10 },
    redactedChoices: ['Lieferschein', 'Sonstiges'],
    redactedRulesChoice: 'Sonstiges',
    ...overrides,
  };
}

describe('gateDocumentSortSuggestion', () => {
  it('settles on the provider reason when there is no usable suggestion', () => {
    expect(
      gateDocumentSortSuggestion(
        { ok: false, reason: 'timeout', suggestion: null },
        'AUTO',
      ),
    ).toEqual({ outcome: 'fallback', reason: 'timeout' });
  });

  it('settles on suggestion_matches_rules when Jev agrees with the heuristic', () => {
    expect(gateDocumentSortSuggestion(suggested('Sonstiges'), 'AUTO')).toEqual({
      outcome: 'fallback',
      reason: 'suggestion_matches_rules',
    });
  });

  it('refuses under HUMAN_ONLY without asking for a write', () => {
    expect(
      gateDocumentSortSuggestion(suggested('Rechnung'), 'HUMAN_ONLY'),
    ).toEqual({ outcome: 'refused', reason: 'human_only' });
  });

  it.each(['AUTO', 'PROPOSE'] as const)(
    'asks for a write of the suggested type under %s',
    (tier) => {
      expect(gateDocumentSortSuggestion(suggested('Rechnung'), tier)).toEqual({
        sortType: 'Rechnung',
      });
    },
  );
});

describe('buildDocumentSortLiveDecision', () => {
  it('targets the asset only when the write applied or was proposed', () => {
    expect(
      buildDocumentSortLiveDecision(
        decisionInput({ write: { outcome: 'applied', reason: null } }),
      ).targetEntityId,
    ).toBe('asset-1');
    expect(
      buildDocumentSortLiveDecision(
        decisionInput({ write: { outcome: 'proposed', reason: null } }),
      ).targetEntityId,
    ).toBe('asset-1');
    expect(
      buildDocumentSortLiveDecision(
        decisionInput({
          write: { outcome: 'fallback', reason: 'target_not_ready' },
        }),
      ).targetEntityId,
    ).toBeNull();
  });

  it('builds a document sort decision on the asset with no row number', () => {
    const decision = buildDocumentSortLiveDecision(decisionInput());

    expect(decision).toMatchObject({
      tenantId: 'tenant-1',
      traceId: 'trace-1',
      useCase: 'document_sort',
      actionType: 'decision.document_sort',
      tier: 'AUTO',
      outcome: 'applied',
      reason: null,
      entityType: 'DocumentBrandAsset',
      entityId: 'asset-1',
      rowNo: null,
      redactedSuggestedChoice: 'Lieferschein',
      redactedRulesChoice: 'Sonstiges',
      providerId: 'openrouter-jev',
    });
  });

  it('has no suggested choice when the provider call failed', () => {
    const decision = buildDocumentSortLiveDecision(
      decisionInput({
        write: { outcome: 'fallback', reason: 'timeout' },
        providerCall: { ok: false, reason: 'timeout', suggestion: null },
      }),
    );

    expect(decision).toMatchObject({
      outcome: 'fallback',
      reason: 'timeout',
      redactedSuggestedChoice: null,
      targetEntityId: null,
    });
  });
});
