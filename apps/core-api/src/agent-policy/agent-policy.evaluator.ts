import { AgentPolicyTier } from '@prisma/client';
import { isHumanOnlyFloorAction } from './agent-policy-floor.js';
import { maxTier } from './agent-policy-tier.util.js';
import type {
  AgentPolicyEvaluateContext,
  AgentPolicyEvaluationResult,
  AgentPolicyConditions,
  ResolvedAgentPolicyRule,
} from './agent-policy.types.js';

export function parseAgentPolicyConditions(
  value: unknown,
): AgentPolicyConditions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const conditions: AgentPolicyConditions = {};

  if (record.amount_max === null) {
    conditions.amount_max = null;
  } else if (typeof record.amount_max === 'number') {
    conditions.amount_max = record.amount_max;
  }

  if (typeof record.customer_facing === 'boolean') {
    conditions.customer_facing = record.customer_facing;
  }
  if (typeof record.reversible === 'boolean') {
    conditions.reversible = record.reversible;
  }
  if (typeof record.affects_legal_document === 'boolean') {
    conditions.affects_legal_document = record.affects_legal_document;
  }

  return conditions;
}

function applyContextEscalations(
  baseTier: AgentPolicyTier,
  conditions: AgentPolicyConditions,
  context: AgentPolicyEvaluateContext,
  reasons: string[],
): AgentPolicyTier {
  let tier = baseTier;

  if (context.customer_facing === true) {
    const next = maxTier(tier, AgentPolicyTier.PROPOSE);
    if (next !== tier) {
      reasons.push('customer_facing_requires_propose');
    }
    tier = next;
  }

  if (
    typeof context.amount_eur === 'number' &&
    typeof conditions.amount_max === 'number' &&
    context.amount_eur > conditions.amount_max
  ) {
    const next = maxTier(tier, AgentPolicyTier.PROPOSE);
    if (next !== tier) {
      reasons.push('amount_above_threshold');
    }
    tier = next;
  }

  return tier;
}

export function evaluateAgentPolicy(
  actionType: string,
  context: AgentPolicyEvaluateContext,
  rule: ResolvedAgentPolicyRule | null,
): AgentPolicyEvaluationResult {
  const reasons: string[] = [];
  const normalizedAction = actionType.trim();

  if (isHumanOnlyFloorAction(normalizedAction)) {
    return {
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['hard_floor_category'],
      rule_id: rule?.id ?? null,
      rule_version: rule?.version ?? null,
    };
  }

  if (!rule || !rule.enabled) {
    return {
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['unknown_action_fail_closed'],
      rule_id: null,
      rule_version: null,
    };
  }

  let tier = rule.tier;
  reasons.push(`base_tier_${rule.tier.toLowerCase()}`);

  tier = applyContextEscalations(tier, rule.conditions, context, reasons);

  return {
    tier,
    reasons,
    rule_id: rule.id,
    rule_version: rule.version,
  };
}
