import { findCodePlatformDefaultRow } from './agent-policy-platform-default.js';
import {
  findLatestPlatformRow,
  type AgentPolicyRuleDeps,
} from './agent-policy-rule.store.js';
import { toResolvedRule } from './agent-policy-rule.util.js';
import type { ResolvedAgentPolicyRule } from './agent-policy.types.js';

/** Platform row when stored, else code default for actions defined only in code. */
export async function findPlatformRule(
  deps: AgentPolicyRuleDeps,
  actionType: string,
): Promise<ResolvedAgentPolicyRule | null> {
  const row = await findLatestPlatformRow(deps, actionType);
  if (row) {
    return toResolvedRule(row, 'platform');
  }
  const codeDefault = findCodePlatformDefaultRow(actionType);
  return codeDefault ? toResolvedRule(codeDefault, 'platform') : null;
}
