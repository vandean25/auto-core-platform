import type { AgentPolicyTier, Prisma } from '@prisma/client';
import { parseAgentPolicyConditions } from './agent-policy.evaluator.js';
import type { ResolvedAgentPolicyRule } from './agent-policy.types.js';

/** A stored AgentPolicyRule row, as the service reads it. */
export type AgentPolicyRuleRow = {
  id: string;
  tenant_id: string | null;
  action_type: string;
  tier: AgentPolicyTier;
  conditions_json: Prisma.JsonValue;
  enabled: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
};

export function toResolvedRule(
  row: AgentPolicyRuleRow,
  source: ResolvedAgentPolicyRule['source'],
): ResolvedAgentPolicyRule {
  return {
    id: row.id,
    version: row.version,
    action_type: row.action_type,
    tier: row.tier,
    conditions: parseAgentPolicyConditions(row.conditions_json),
    enabled: row.enabled,
    source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Keeps the newest version of each action type. Rows must be ordered by
 * action type, then version descending, so the first row seen wins.
 */
export function latestRowPerAction(
  rows: AgentPolicyRuleRow[],
): AgentPolicyRuleRow[] {
  const latest = new Map<string, AgentPolicyRuleRow>();
  for (const row of rows) {
    if (!latest.has(row.action_type)) {
      latest.set(row.action_type, row);
    }
  }
  return [...latest.values()];
}

/**
 * One effective rule per action type, sorted by action type. The tenant
 * override wins when the tenant has one; otherwise the platform default applies.
 */
export function mergeEffectiveRules(
  platformRows: AgentPolicyRuleRow[],
  tenantRows: AgentPolicyRuleRow[],
): ResolvedAgentPolicyRule[] {
  const effective = new Map<string, ResolvedAgentPolicyRule>();
  for (const row of latestRowPerAction(platformRows)) {
    effective.set(row.action_type, toResolvedRule(row, 'platform'));
  }
  for (const row of latestRowPerAction(tenantRows)) {
    effective.set(row.action_type, toResolvedRule(row, 'tenant'));
  }
  return [...effective.values()].sort((left, right) =>
    compareCodeUnits(left.action_type, right.action_type),
  );
}

/** Plain string order (UTF-16 code units), the order the list has always used. */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
