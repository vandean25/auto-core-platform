import type { DecisionShadowLogRecord } from './decision-shadow-log.types.js';
import { mapDecisionShadowLog } from './decision-shadow-log.mapper.js';

function buildRecord(
  overrides: Partial<DecisionShadowLogRecord> = {},
): DecisionShadowLogRecord {
  return {
    id: 'row-1',
    trace_id: '00000000-0000-4000-8000-00000000a001',
    use_case: 'document_sort',
    suggestion_json: {
      choice: 'Rechnung',
      confidence: 0.91,
      rationale: 'Made-up rationale for a synthetic document',
      raw_ref: 'resp-made-up-1',
      latency_ms: 42,
      provider: 'openrouter-jev',
      model: 'typesafe/jev-1.13',
    },
    actual_outcome_json: { choice: 'Rechnung', source: 'heuristic_classifier' },
    match: true,
    provider: 'openrouter-jev',
    model: 'typesafe/jev-1.13',
    latency_ms: 42,
    error: null,
    created_at: new Date('2026-10-03T10:00:00.000Z'),
    ...overrides,
  };
}

describe('mapDecisionShadowLog', () => {
  it('maps a successful shadow run and returns error null', () => {
    expect(mapDecisionShadowLog(buildRecord())).toEqual({
      id: 'row-1',
      traceId: '00000000-0000-4000-8000-00000000a001',
      useCase: 'document_sort',
      suggestion: {
        choice: 'Rechnung',
        confidence: 0.91,
        rationale: 'Made-up rationale for a synthetic document',
      },
      actualOutcome: { choice: 'Rechnung', source: 'heuristic_classifier' },
      latencyMs: 42,
      error: null,
      provider: 'openrouter-jev',
      model: 'typesafe/jev-1.13',
      match: true,
      createdAt: new Date('2026-10-03T10:00:00.000Z'),
    });
  });

  it('maps a provider failure without a suggestion', () => {
    const mapped = mapDecisionShadowLog(
      buildRecord({
        suggestion_json: null,
        match: null,
        model: null,
        latency_ms: null,
        error: 'provider down',
      }),
    );

    expect(mapped.suggestion).toBeNull();
    expect(mapped.match).toBeNull();
    expect(mapped.model).toBeNull();
    expect(mapped.latencyMs).toBeNull();
    expect(mapped.error).toBe('provider down');
  });

  it('does not expose a malformed suggestion payload', () => {
    expect(
      mapDecisionShadowLog(
        buildRecord({ suggestion_json: ['not', 'an-object'] }),
      ).suggestion,
    ).toBeNull();
    expect(
      mapDecisionShadowLog(
        buildRecord({ suggestion_json: { confidence: 0.5 } }),
      ).suggestion,
    ).toBeNull();
  });

  it('keeps suggestion fields typed and drops provider-internal fields', () => {
    const mapped = mapDecisionShadowLog(
      buildRecord({
        suggestion_json: { choice: 'choice_2', confidence: 'high' },
      }),
    );

    expect(mapped.suggestion).toEqual({
      choice: 'choice_2',
      confidence: null,
      rationale: null,
    });
    expect(mapped.suggestion).not.toHaveProperty('raw_ref');
  });
});
