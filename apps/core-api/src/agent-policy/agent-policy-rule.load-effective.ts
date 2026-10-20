import { withCodePlatformDefaults } from './agent-policy-rule.lookup.code-defaults.js';
import {
  findPlatformRuleRows,
  findTenantRuleRows,
  type AgentPolicyRuleDeps,
} from './agent-policy-rule.store.js';
import { mergeEffectiveRules } from './agent-policy-rule.util.js';
import type { ResolvedAgentPolicyRule } from './agent-policy.types.js';

/** Stored platform and tenant rules only (no code defaults). */
export async function loadStoredEffectiveRules(
  deps: AgentPolicyRuleDeps,
  tenantId: string,
): Promise<ResolvedAgentPolicyRule[]> {
  const platformRows = await findPlatformRuleRows(deps);
  const tenantRows = await findTenantRuleRows(deps, tenantId);
  return mergeEffectiveRules(platformRows, tenantRows);
}

/** Effective rules for a tenant, including code platform defaults for list APIs. */
export async function loadEffectiveRules(
  deps: AgentPolicyRuleDeps,
  tenantId: string,
): Promise<ResolvedAgentPolicyRule[]> {
  return withCodePlatformDefaults(
    await loadStoredEffectiveRules(deps, tenantId),
  );
}
