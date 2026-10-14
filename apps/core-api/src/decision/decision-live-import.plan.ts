import { AgentPolicyTier, ImportRowAction } from '@prisma/client';
import type { ImportJobTotals } from '../import/import.types.js';
import { DECISION_USE_CASES } from './decision.constants.js';
import { IMPORT_ACTION_TYPE } from './decision-live-apply.constants.js';
import type { ImportRowMatchChange } from './decision-live-apply.util.js';
import type {
  DecisionLiveReason,
  LiveDecision,
  ProviderCall,
} from './decision-live-apply.types.js';
import type { ImportRowMatchingCase } from './decision-use-case-hooks.service.js';

/** One import row sent to the provider, with the mapping back to real choice labels. */
export type ImportCall = {
  matchingCase: ImportRowMatchingCase;
  redactedInput: unknown;
  redactedChoices: string[];
  redactedRulesChoice: string;
  /** Maps the redacted choice label back to the real choice label. */
  originalByRedacted: Map<string, string>;
  providerCall: ProviderCall;
};

export type ChangeImportPlan = {
  kind: 'change';
  call: ImportCall;
  change: ImportRowMatchChange;
};

export type ImportPlan =
  | ChangeImportPlan
  | { kind: 'fallback'; call: ImportCall; reason: DecisionLiveReason };

export type ImportWriteState = {
  appliedRowNos: ReadonlySet<number>;
  applyFailed: boolean;
  proposalFailed: boolean;
};

/** Pairs each redacted choice label with the real label at the same position. */
export function pairRedactedChoices(
  redactedChoices: string[],
  originalChoices: string[],
): Map<string, string> {
  return new Map(
    redactedChoices.map((choice, index): [string, string] => [
      choice,
      originalChoices[index],
    ]),
  );
}

export function isChangePlan(plan: ImportPlan): plan is ChangeImportPlan {
  return plan.kind === 'change';
}

export function planImportChange(call: ImportCall): ImportPlan {
  const { matchingCase, providerCall } = call;
  if (!providerCall.ok) {
    return { kind: 'fallback', call, reason: providerCall.reason };
  }
  const choice = call.originalByRedacted.get(providerCall.suggestion.choice);
  if (choice === undefined) {
    return { kind: 'fallback', call, reason: 'invalid_choice' };
  }
  if (choice === matchingCase.actualChoice) {
    return { kind: 'fallback', call, reason: 'suggestion_matches_rules' };
  }
  // Only a real customer match on a CREATE row is adoptable. Same-file
  // candidates, create_new over an existing match, and rows the rules already
  // matched stay with the rules outcome.
  const target = matchingCase.candidateTargets.find(
    (candidate) => candidate.choice === choice,
  );
  const customerId = target?.entityId ?? null;
  if (
    choice === matchingCase.createChoice ||
    customerId === null ||
    matchingCase.row.action !== ImportRowAction.CREATE
  ) {
    return { kind: 'fallback', call, reason: 'not_applicable' };
  }
  return {
    kind: 'change',
    call,
    change: { row_no: matchingCase.row.row_no, customer_id: customerId },
  };
}

/** One audit decision per planned row, with the outcome the tier and the write left it in. */
export function buildImportLiveDecisions(input: {
  tenantId: string;
  traceId: string;
  jobId: string;
  tier: AgentPolicyTier;
  policyReasons: string[];
  providerId: string;
  plans: ImportPlan[];
  write: ImportWriteState;
}): LiveDecision[] {
  return input.plans.map((plan): LiveDecision => {
    const { call } = plan;
    return {
      tenantId: input.tenantId,
      traceId: input.traceId,
      useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
      actionType: IMPORT_ACTION_TYPE,
      tier: input.tier,
      policyReasons: input.policyReasons,
      entityType: 'ImportJob',
      entityId: input.jobId,
      redactedInput: call.redactedInput,
      redactedChoices: call.redactedChoices,
      redactedRulesChoice: call.redactedRulesChoice,
      redactedSuggestedChoice: call.providerCall.ok
        ? call.providerCall.suggestion.choice
        : null,
      providerCall: call.providerCall,
      providerId: input.providerId,
      rowNo: call.matchingCase.row.row_no,
      ...resolveImportOutcome(plan, input.tier, input.write),
    };
  });
}

function resolveImportOutcome(
  plan: ImportPlan,
  tier: AgentPolicyTier,
  write: ImportWriteState,
): Pick<LiveDecision, 'outcome' | 'reason' | 'targetEntityId'> {
  if (plan.kind === 'fallback') {
    return { outcome: 'fallback', reason: plan.reason, targetEntityId: null };
  }
  if (tier === AgentPolicyTier.AUTO) {
    return autoImportOutcome(plan, write);
  }
  if (tier === AgentPolicyTier.PROPOSE) {
    return proposeImportOutcome(plan, write);
  }
  return { outcome: 'refused', reason: 'human_only', targetEntityId: null };
}

function autoImportOutcome(
  plan: ChangeImportPlan,
  write: ImportWriteState,
): Pick<LiveDecision, 'outcome' | 'reason' | 'targetEntityId'> {
  if (write.appliedRowNos.has(plan.change.row_no)) {
    return {
      outcome: 'applied',
      reason: null,
      targetEntityId: plan.change.customer_id,
    };
  }
  return {
    outcome: 'fallback',
    reason: write.applyFailed ? 'apply_failed' : 'record_changed',
    targetEntityId: null,
  };
}

function proposeImportOutcome(
  plan: ChangeImportPlan,
  write: ImportWriteState,
): Pick<LiveDecision, 'outcome' | 'reason' | 'targetEntityId'> {
  if (write.proposalFailed) {
    return {
      outcome: 'fallback',
      reason: 'apply_failed',
      targetEntityId: null,
    };
  }
  return {
    outcome: 'proposed',
    reason: null,
    targetEntityId: plan.change.customer_id,
  };
}

export type ImportWriteResult = ImportWriteState & { totals: ImportJobTotals };

export function emptyImportWrite(totals: ImportJobTotals): ImportWriteResult {
  return {
    totals,
    appliedRowNos: new Set<number>(),
    applyFailed: false,
    proposalFailed: false,
  };
}
