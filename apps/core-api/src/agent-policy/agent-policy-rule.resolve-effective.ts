import { BadRequestException } from '@nestjs/common';
import { AGENT_POLICY_ERROR_CODES } from './agent-policy.constants.js';
import { findPlatformRule } from './agent-policy-rule.lookup.platform.js';
import {
  findLatestTenantRow,
  type AgentPolicyRuleDeps,
} from './agent-policy-rule.store.js';
import { toResolvedRule } from './agent-policy-rule.util.js';
import type { ResolvedAgentPolicyRule } from './agent-policy.types.js';

/**
 * Configured rule for an action in the tenant: the tenant override when one
 * exists, else the platform default, else the platform's code default, else null.
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
  return findPlatformRule(deps, actionType);
}

/** The platform default for an action. An action the platform does not define is a 400. */
export async function requirePlatformRule(
  deps: AgentPolicyRuleDeps,
  actionType: string,
): Promise<ResolvedAgentPolicyRule> {
  const rule = await findPlatformRule(deps, actionType);
  if (!rule) {
    throw new BadRequestException({
      code: AGENT_POLICY_ERROR_CODES.UNKNOWN_ACTION_TYPE,
      message: `Unknown action type: ${actionType}`,
    });
  }
  return rule;
}
