import { AgentPolicyTier } from '@prisma/client';
import { withSpan } from '../common/observability/trace.js';
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

  const customerFacing =
    context.customer_facing === true || conditions.customer_facing === true;
  if (customerFacing) {
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

/** The policy outcome as the agent sees it. Used on `agent.policy.outcome` and `agent.decision` spans. */
export function agentPolicyOutcome(
  tier: AgentPolicyTier,
): 'allowed' | 'proposed' | 'refused' {
  if (tier === AgentPolicyTier.AUTO) return 'allowed';
  if (tier === AgentPolicyTier.PROPOSE) return 'proposed';
  return 'refused';
}

export function evaluateAgentPolicy(
  actionType: string,
  context: AgentPolicyEvaluateContext,
  rule: ResolvedAgentPolicyRule | null,
): AgentPolicyEvaluationResult {
  // The action type is not recorded here. Policy reads take it from free text, while the MCP
  // agent.action span already carries the trusted tool name.
  return withSpan(
    'Evaluate agent policy',
    'agent.policy.evaluate',
    {},
    (span) => {
      const evaluation = evaluateAgentPolicyRules(actionType, context, rule);
      span.setAttributes({
        'agent.policy.tier': evaluation.tier,
        'agent.policy.outcome': agentPolicyOutcome(evaluation.tier),
      });
      return evaluation;
    },
  );
}

function evaluateAgentPolicyRules(
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

  if (!rule) {
    return {
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['unknown_action_fail_closed'],
      rule_id: null,
      rule_version: null,
    };
  }

  if (!rule.enabled) {
    return {
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['rule_disabled_fail_closed'],
      rule_id: rule.id,
      rule_version: rule.version,
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
