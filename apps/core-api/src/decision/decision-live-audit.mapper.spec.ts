import type { LiveDecision } from './decision-live-apply.types.js';
import {
  buildLiveActionLogInput,
  buildLiveShadowRecord,
} from './decision-live-audit.mapper.js';

const TRACE_ID = '2f1c2b5e-6a1f-4f5e-9d3a-0c1b2a3d4e5f';

function importDecision(overrides: Partial<LiveDecision> = {}): LiveDecision {
  return {
    tenantId: 'tenant-1',
    useCase: 'import_row_matching',
    actionType: 'decision.import_row_match',
    tier: 'AUTO',
    policyReasons: ['base_tier_auto'],
    traceId: TRACE_ID,
    outcome: 'applied',
    reason: null,
    entityType: 'ImportJob',
    entityId: 'job-1',
    redactedInput: { row: { type: 'PRIVATE' } },
    redactedChoices: ['choice_1', 'choice_2'],
    redactedRulesChoice: 'choice_2',
    redactedSuggestedChoice: 'choice_1',
    providerCall: {
      ok: true,
      suggestion: {
        choice: 'choice_1',
        raw_ref: 'raw-1',
        latency_ms: 12,
        provider: 'openrouter-jev',
        model: 'typesafe/jev-1.13',
        rationale: 'Quotes the excerpt.',
      },
    },
    providerId: 'openrouter-jev',
    targetEntityId: 'customer-1',
    rowNo: 1,
    ...overrides,
  };
}

function documentSortDecision(
  overrides: Partial<LiveDecision> = {},
): LiveDecision {
  return importDecision({
    useCase: 'document_sort',
    actionType: 'decision.document_sort',
    entityType: 'DocumentBrandAsset',
    entityId: 'asset-1',
    redactedChoices: ['Rechnung', 'Sonstiges'],
    redactedRulesChoice: 'Sonstiges',
    redactedSuggestedChoice: 'Rechnung',
    providerCall: {
      ok: true,
      suggestion: {
        choice: 'Rechnung',
        raw_ref: 'raw-1',
        latency_ms: 12,
        provider: 'openrouter-jev',
        model: 'typesafe/jev-1.13',
        rationale: 'Quotes the excerpt.',
      },
    },
    targetEntityId: 'asset-1',
    rowNo: null,
    ...overrides,
  });
}

describe('buildLiveActionLogInput', () => {
  it.each([
    ['applied', 'EXECUTED'],
    ['proposed', 'PROPOSED'],
    ['refused', 'REFUSED'],
    ['fallback', 'FALLBACK'],
  ] as const)('maps the %s outcome to %s', (outcome, status) => {
    expect(buildLiveActionLogInput(importDecision({ outcome })).status).toBe(
      status,
    );
  });

  it('writes a SYSTEM action with the redacted summaries and no reversal', () => {
    expect(buildLiveActionLogInput(importDecision())).toEqual({
      traceId: TRACE_ID,
      actorType: 'SYSTEM',
      actionType: 'decision.import_row_match',
      tier: 'AUTO',
      status: 'EXECUTED',
      inputSummary: {
        mode: 'live',
        use_case: 'import_row_matching',
        input: { row: { type: 'PRIVATE' } },
        choices: ['choice_1', 'choice_2'],
      },
      resultSummary: {
        mode: 'live',
        outcome: 'applied',
        reason: null,
        rules_choice: 'choice_2',
        suggested_choice: 'choice_1',
        target_entity_id: 'customer-1',
        row_no: 1,
        provider: 'openrouter-jev',
        model: 'typesafe/jev-1.13',
        latency_ms: 12,
        policy_reasons: ['base_tier_auto'],
      },
      entityType: 'ImportJob',
      entityId: 'job-1',
      reversible: false,
    });
  });

  it('falls back to the provider id, with null model and latency, when there is no suggestion', () => {
    const entry = buildLiveActionLogInput(
      importDecision({
        outcome: 'fallback',
        reason: 'timeout',
        redactedSuggestedChoice: null,
        providerCall: { ok: false, reason: 'timeout', suggestion: null },
      }),
    );

    expect(entry.resultSummary).toMatchObject({
      reason: 'timeout',
      suggested_choice: null,
      provider: 'openrouter-jev',
      model: null,
      latency_ms: null,
    });
  });

  it('never carries the provider rationale', () => {
    const entry = buildLiveActionLogInput(importDecision());

    expect(JSON.stringify(entry)).not.toContain('Quotes the excerpt.');
  });
});

describe('buildLiveShadowRecord', () => {
  it('names the import source for import matching and keeps the rationale', () => {
    const record = buildLiveShadowRecord(importDecision());

    expect(record.params).toEqual({
      tenantId: 'tenant-1',
      traceId: TRACE_ID,
      useCase: 'import_row_matching',
      input: { row: { type: 'PRIVATE' } },
      choices: ['choice_1', 'choice_2'],
      actualOutcome: { choice: 'choice_2', source: 'import_dry_run' },
    });
    expect(record.outcome).toEqual({
      suggestion: expect.objectContaining({
        choice: 'choice_1',
        rationale: 'Quotes the excerpt.',
      }),
      error: null,
      providerId: 'openrouter-jev',
    });
  });

  it('names the heuristic source for document sort and drops the rationale', () => {
    const record = buildLiveShadowRecord(documentSortDecision());

    expect(record.params.actualOutcome).toEqual({
      choice: 'Sonstiges',
      source: 'heuristic_classifier',
    });
    expect(record.outcome.suggestion).toEqual({
      choice: 'Rechnung',
      raw_ref: 'raw-1',
      latency_ms: 12,
      provider: 'openrouter-jev',
      model: 'typesafe/jev-1.13',
    });
    expect(JSON.stringify(record)).not.toContain('Quotes the excerpt.');
  });

  it('carries the provider reason and no suggestion for a failed call', () => {
    const record = buildLiveShadowRecord(
      importDecision({
        providerCall: { ok: false, reason: 'provider_error', suggestion: null },
      }),
    );

    expect(record.outcome).toEqual({
      suggestion: null,
      error: 'provider_error',
      providerId: 'openrouter-jev',
    });
  });
});
