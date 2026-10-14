import { AgentPolicyTier } from '@prisma/client';
import {
  DECISION_USE_CASES,
  type DocumentSortType,
} from './decision.constants.js';
import {
  DOCUMENT_SORT_ACTION_TYPE,
  DOCUMENT_SORT_RULES_FINAL_TYPE,
} from './decision-live-apply.constants.js';
import type {
  DecisionLiveOutcome,
  DecisionLiveReason,
  LiveDecision,
  ProviderCall,
} from './decision-live-apply.types.js';

/** The outcome a document sort step settled on without a write, or the type to write. */
export type DocumentSortWrite = {
  outcome: DecisionLiveOutcome;
  reason: DecisionLiveReason | null;
};

export type DocumentSortGate =
  DocumentSortWrite | { sortType: DocumentSortType };

/**
 * Decides, before any write, what a provider answer leads to. Only a type the
 * heuristic did not decide reaches a write, and HUMAN_ONLY never does.
 */
export function gateDocumentSortSuggestion(
  providerCall: ProviderCall,
  tier: AgentPolicyTier,
): DocumentSortGate {
  if (!providerCall.ok) {
    return { outcome: 'fallback', reason: providerCall.reason };
  }
  if (providerCall.suggestion.choice === DOCUMENT_SORT_RULES_FINAL_TYPE) {
    return { outcome: 'fallback', reason: 'suggestion_matches_rules' };
  }
  if (tier === AgentPolicyTier.HUMAN_ONLY) {
    return { outcome: 'refused', reason: 'human_only' };
  }
  return {
    sortType: providerCall.suggestion.choice as DocumentSortType,
  };
}

export type DocumentSortDecisionInput = {
  tenantId: string;
  traceId: string;
  assetId: string;
  tier: AgentPolicyTier;
  policyReasons: string[];
  write: DocumentSortWrite;
  providerCall: ProviderCall;
  providerId: string;
  /** Signals plus the excerpt's length and hash. Never the excerpt text. */
  redactedInput: unknown;
  redactedChoices: string[];
  redactedRulesChoice: string;
};

export function buildDocumentSortLiveDecision(
  input: DocumentSortDecisionInput,
): LiveDecision {
  const { outcome, reason } = input.write;
  return {
    tenantId: input.tenantId,
    traceId: input.traceId,
    useCase: DECISION_USE_CASES.DOCUMENT_SORT,
    actionType: DOCUMENT_SORT_ACTION_TYPE,
    tier: input.tier,
    policyReasons: input.policyReasons,
    outcome,
    reason,
    entityType: 'DocumentBrandAsset',
    entityId: input.assetId,
    redactedInput: input.redactedInput,
    redactedChoices: input.redactedChoices,
    redactedRulesChoice: input.redactedRulesChoice,
    redactedSuggestedChoice: input.providerCall.ok
      ? input.providerCall.suggestion.choice
      : null,
    providerCall: input.providerCall,
    providerId: input.providerId,
    targetEntityId:
      outcome === 'applied' || outcome === 'proposed' ? input.assetId : null,
    rowNo: null,
  };
}
