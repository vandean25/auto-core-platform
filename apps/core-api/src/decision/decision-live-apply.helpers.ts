import type { AgentPolicyTier } from '@prisma/client';
import type { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { DecisionResult } from './decision.types.js';

/** Tier and reasons for an action type, evaluated with an empty context. */
export async function evaluateDecisionTier(
  agentPolicy: Pick<AgentPolicyService, 'evaluateAction'>,
  actionType: string,
): Promise<{ tier: AgentPolicyTier; reasons: string[] }> {
  const evaluation = await agentPolicy.evaluateAction(actionType, {});
  return { tier: evaluation.tier, reasons: evaluation.reasons };
}

/** Copy without the provider rationale, which can quote the document excerpt. */
export function withoutRationale(suggestion: DecisionResult): DecisionResult {
  const copy = { ...suggestion };
  delete copy.rationale;
  return copy;
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
