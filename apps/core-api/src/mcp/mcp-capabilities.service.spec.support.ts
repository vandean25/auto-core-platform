import { AgentPolicyTier } from '@prisma/client';
import type { ResolvedAgentPolicyRule } from '../agent-policy/agent-policy.types.js';
/** A platform policy rule for the capability tests. */
export function policyRule(
  actionType: string,
  overrides: Partial<ResolvedAgentPolicyRule> = {},
): ResolvedAgentPolicyRule {
  return {
    id: `rule-${actionType}`,
    version: 1,
    action_type: actionType,
    tier: AgentPolicyTier.AUTO,
    conditions: {},
    enabled: true,
    source: 'platform',
    created_at: new Date('2026-10-01T00:00:00.000Z'),
    updated_at: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** The policy rules the capability tests read. */
export const TENANT_A_RULES: Record<string, ResolvedAgentPolicyRule | null> = {
  'workshop_order.create': policyRule('workshop_order.create', {
    enabled: false,
  }),
  'inventory.part_reserve': policyRule('inventory.part_reserve'),
  'inventory.part_release': policyRule('inventory.part_release', {
    tier: AgentPolicyTier.HUMAN_ONLY,
  }),
  // A policy row that says AUTO must still be held at PROPOSE by the MCP clamp.
  'workshop_order.propose_line': policyRule('workshop_order.propose_line'),
  'registration_intake.apply': policyRule('registration_intake.apply', {
    enabled: false,
  }),
  'workshop.booking_package': policyRule('workshop.booking_package', {
    enabled: false,
  }),
  'purchase_order.propose_draft': policyRule('purchase_order.propose_draft', {
    enabled: false,
  }),
  'workshop_order.complete': policyRule('workshop_order.complete', {
    enabled: false,
  }),
  'invoice.create_draft_from_workshop_order': policyRule(
    'invoice.create_draft_from_workshop_order',
    { enabled: false },
  ),
  'estimate.send_customer_message': policyRule('estimate.send_customer_message', {
    enabled: false,
  }),
  'workshop.media_upload_slot': policyRule('workshop.media_upload_slot', {
    enabled: false,
  }),
  'workshop_order.propose_mechanic_finding': policyRule(
    'workshop_order.propose_mechanic_finding',
    { enabled: false },
  ),
  'customer.create': policyRule('customer.create', {
    tier: AgentPolicyTier.PROPOSE,
    enabled: false,
  }),
  'customer.update': policyRule('customer.update', {
    tier: AgentPolicyTier.PROPOSE,
    enabled: false,
  }),
  'report.generate_weekly_pdf': policyRule('report.generate_weekly_pdf', {
    enabled: false,
  }),
};
