import type {
  AgentActionRecordInput,
  AgentActionStatus,
} from '../agent-action-log/agent-action-log.types.js';
import { DECISION_USE_CASES } from './decision.constants.js';
import type {
  DecisionResult,
  DecisionShadowRecordParams,
} from './decision.types.js';
import { withoutRationale } from './decision-live-apply.helpers.js';
import type {
  DecisionLiveOutcome,
  LiveDecision,
} from './decision-live-apply.types.js';

const LIVE_OUTCOME_STATUS: Record<DecisionLiveOutcome, AgentActionStatus> = {
  applied: 'EXECUTED',
  proposed: 'PROPOSED',
  refused: 'REFUSED',
  fallback: 'FALLBACK',
};

/**
 * Audit row for one live decision. It never carries provider rationale or raw
 * model output. Only redacted input, choices and the suggested choice are kept.
 */
export function buildLiveActionLogInput(
  decision: LiveDecision,
): AgentActionRecordInput {
  const suggestion = suggestionOf(decision);
  return {
    traceId: decision.traceId,
    actorType: 'SYSTEM',
    actionType: decision.actionType,
    tier: decision.tier,
    status: LIVE_OUTCOME_STATUS[decision.outcome],
    inputSummary: {
      mode: 'live',
      use_case: decision.useCase,
      input: decision.redactedInput,
      choices: decision.redactedChoices,
    },
    resultSummary: {
      mode: 'live',
      outcome: decision.outcome,
      reason: decision.reason,
      rules_choice: decision.redactedRulesChoice,
      suggested_choice: decision.redactedSuggestedChoice,
      target_entity_id: decision.targetEntityId,
      row_no: decision.rowNo,
      provider: suggestion?.provider ?? decision.providerId,
      model: suggestion?.model ?? null,
      latency_ms: suggestion?.latency_ms ?? null,
      policy_reasons: decision.policyReasons,
    },
    entityType: decision.entityType,
    entityId: decision.entityId,
    reversible: false,
  };
}

/**
 * Shadow row for one live decision. The rationale is dropped for document sort,
 * because it can quote the excerpt. The suggestion is reused, so Jev is not called twice.
 */
export function buildLiveShadowRecord(decision: LiveDecision): {
  params: DecisionShadowRecordParams;
  outcome: {
    suggestion: DecisionResult | null;
    error: string | null;
    providerId: string;
  };
} {
  const suggestion = suggestionOf(decision);
  const shadowSuggestion =
    suggestion && decision.useCase === DECISION_USE_CASES.DOCUMENT_SORT
      ? withoutRationale(suggestion)
      : suggestion;
  return {
    params: {
      tenantId: decision.tenantId,
      traceId: decision.traceId,
      useCase: decision.useCase,
      input: decision.redactedInput,
      choices: decision.redactedChoices,
      actualOutcome: {
        choice: decision.redactedRulesChoice,
        source:
          decision.useCase === DECISION_USE_CASES.IMPORT_ROW_MATCHING
            ? 'import_dry_run'
            : 'heuristic_classifier',
      },
    } satisfies DecisionShadowRecordParams,
    outcome: {
      suggestion: shadowSuggestion,
      error: decision.providerCall.ok ? null : decision.providerCall.reason,
      providerId: decision.providerId,
    },
  };
}

function suggestionOf(decision: LiveDecision): DecisionResult | null {
  return decision.providerCall.ok ? decision.providerCall.suggestion : null;
}
