import {
  findCodePlatformDefaultRow,
  listCodePlatformDefaultActionTypes,
} from './agent-policy-platform-default.js';
import { toResolvedRule } from './agent-policy-rule.util.js';
import type { ResolvedAgentPolicyRule } from './agent-policy.types.js';

/** Appends code platform defaults for actions that have no stored rule row yet. */
export function withCodePlatformDefaults(
  merged: ResolvedAgentPolicyRule[],
): ResolvedAgentPolicyRule[] {
  const known = new Set(merged.map((rule) => rule.action_type));
  const withDefaults = [...merged];
  for (const actionType of listCodePlatformDefaultActionTypes()) {
    if (known.has(actionType)) {
      continue;
    }
    const codeDefault = findCodePlatformDefaultRow(actionType);
    if (codeDefault) {
      withDefaults.push(toResolvedRule(codeDefault, 'platform'));
      known.add(actionType);
    }
  }
  return withDefaults.sort((left, right) =>
    left.action_type < right.action_type
      ? -1
      : left.action_type > right.action_type
        ? 1
        : 0,
  );
}
