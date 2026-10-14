import { BadRequestException } from '@nestjs/common';
import { AGENT_POLICY_ERROR_CODES } from './agent-policy.constants.js';
import {
  findLatestPlatformRow,
  findLatestTenantRow,
  findPlatformRuleRows,
  findTenantRuleRows,
  type AgentPolicyRuleDeps,
} from './agent-policy-rule.store.js';
import {
  mergeEffectiveRules,
  toResolvedRule,
} from './agent-policy-rule.util.js';
import type { ResolvedAgentPolicyRule } from './agent-policy.types.js';

/**
 * Configured rule for an action in the tenant: the tenant override when one
 * exists, else the platform default, else null.
 */
export async function resolveEffectiveRule(
  deps: AgentPolicyRuleDeps,
  tenantId: string,
  actionType: string,
): Promise<ResolvedAgentPolicyRule | null> {
  const tenantRow = await findLatestTenantRow(deps, tenantId, actionType);
  if (tenantRow) {
    return toResolvedRule(tenantRow, 'tenant');
  }

  const platformRow = await findLatestPlatformRow(deps, actionType);
  return platformRow ? toResolvedRule(platformRow, 'platform') : null;
}

/** The platform default for an action. An action the platform does not define is a 400. */
export async function requirePlatformRule(
  deps: AgentPolicyRuleDeps,
  actionType: string,
): Promise<ResolvedAgentPolicyRule> {
  const row = await findLatestPlatformRow(deps, actionType);
  if (!row) {
    throw new BadRequestException({
      code: AGENT_POLICY_ERROR_CODES.UNKNOWN_ACTION_TYPE,
      message: `Unknown action type: ${actionType}`,
    });
  }
  return toResolvedRule(row, 'platform');
}

/** Every action's effective rule for the tenant, sorted by action type. */
export async function loadEffectiveRules(
  deps: AgentPolicyRuleDeps,
  tenantId: string,
): Promise<ResolvedAgentPolicyRule[]> {
  const platformRows = await findPlatformRuleRows(deps);
  const tenantRows = await findTenantRuleRows(deps, tenantId);
  return mergeEffectiveRules(platformRows, tenantRows);
}
