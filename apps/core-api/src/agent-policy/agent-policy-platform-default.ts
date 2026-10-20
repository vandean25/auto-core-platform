import { AgentPolicyTier } from '@prisma/client';
import type { AgentPolicyRuleRow } from './agent-policy-rule.util.js';

/** The action types of the customer write tools (AUT-613). */
export const CUSTOMER_POLICY_ACTION_TYPES = {
  create: 'customer.create',
  update: 'customer.update',
} as const;

type CodePlatformDefault = {
  tier: AgentPolicyTier;
  enabled: boolean;
};

/**
 * Platform defaults that live in code, for action types the platform defines
 * without a stored rule row. AUT-613 is a non-schema ticket, so the customer
 * actions get their default here instead of from a seeded migration. A stored
 * platform row always wins over this default, and a tenant rule wins over both.
 */
const CODE_PLATFORM_DEFAULTS: Record<string, CodePlatformDefault> = {
  [CUSTOMER_POLICY_ACTION_TYPES.create]: {
    tier: AgentPolicyTier.PROPOSE,
    enabled: false,
  },
  [CUSTOMER_POLICY_ACTION_TYPES.update]: {
    tier: AgentPolicyTier.PROPOSE,
    enabled: false,
  },
};

/** The date the code defaults were introduced; a code default has no row date. */
const CODE_DEFAULT_DATE = new Date('2026-10-19T00:00:00.000Z');

/** Every action type that has a code platform default row. */
export function listCodePlatformDefaultActionTypes(): string[] {
  return Object.keys(CODE_PLATFORM_DEFAULTS);
}

/** The code default of an action, or null when the platform defines no default. */
export function findCodePlatformDefaultRow(
  actionType: string,
): AgentPolicyRuleRow | null {
  const preset = CODE_PLATFORM_DEFAULTS[actionType];
  if (!preset) {
    return null;
  }
  return {
    id: `code-default:${actionType}`,
    tenant_id: null,
    action_type: actionType,
    tier: preset.tier,
    conditions_json: {},
    enabled: preset.enabled,
    version: 1,
    created_at: CODE_DEFAULT_DATE,
    updated_at: CODE_DEFAULT_DATE,
  };
}
