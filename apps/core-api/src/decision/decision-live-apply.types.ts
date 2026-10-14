import type { AgentPolicyTier } from '@prisma/client';
import type {
  DryRunRowResult,
  ImportJobTotals,
} from '../import/import.types.js';
import type { DecisionUseCase } from './decision.constants.js';
import type { DecisionResult } from './decision.types.js';

export type DecisionLiveOutcome =
  'applied' | 'proposed' | 'refused' | 'fallback';

/** Why a decision did not change anything. The rules outcome is kept in every case. */
export type DecisionLiveReason =
  | 'no_suggestion'
  | 'provider_error'
  | 'timeout'
  | 'budget_exceeded'
  | 'invalid_choice'
  | 'suggestion_matches_rules'
  | 'not_applicable'
  | 'target_not_ready'
  | 'record_changed'
  | 'apply_failed'
  | 'human_only';

export type CustomerImportLiveResult =
  { mode: 'shadow' } | { mode: 'live'; totals: ImportJobTotals };

export type CustomerImportDecisionParams = {
  tenantId: string;
  traceId?: string;
  jobId: string;
  rows: DryRunRowResult[];
  totals: ImportJobTotals;
};

export type DocumentSortDecisionParams = {
  tenantId: string;
  assetId: string;
  traceId?: string;
  text: string;
};

/** Result of one bounded provider call. A suggestion is kept only when its choice is allowed. */
export type ProviderCall =
  | { ok: true; suggestion: DecisionResult }
  | {
      ok: false;
      reason: Extract<
        DecisionLiveReason,
        | 'no_suggestion'
        | 'provider_error'
        | 'timeout'
        | 'budget_exceeded'
        | 'invalid_choice'
      >;
      suggestion: DecisionResult | null;
    };

/** One live decision, ready for the audit row and, when enabled, the shadow row. */
export type LiveDecision = {
  tenantId: string;
  useCase: DecisionUseCase;
  actionType: string;
  tier: AgentPolicyTier;
  policyReasons: string[];
  traceId: string;
  outcome: DecisionLiveOutcome;
  reason: DecisionLiveReason | null;
  entityType: string;
  entityId: string;
  /** Redacted with redactShadowParams. Never raw customer data or document text. */
  redactedInput: unknown;
  redactedChoices: string[];
  redactedRulesChoice: string;
  redactedSuggestedChoice: string | null;
  providerCall: ProviderCall;
  providerId: string;
  targetEntityId: string | null;
  rowNo: number | null;
};
