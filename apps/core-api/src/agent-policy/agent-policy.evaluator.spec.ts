import { AgentPolicyTier } from '@prisma/client';
import { evaluateAgentPolicy } from './agent-policy.evaluator.js';
import type { ResolvedAgentPolicyRule } from './agent-policy.types.js';

const floorCases = [
  'invoice.finalize',
  'credit_note.issue',
  'credit_note.adjust',
  'tax_vat.update_wording',
  'accounting_export.create',
  'accounting_export.submit',
  'customer.delete',
  'tenant_member.role_change',
  'consent.update',
];

function rule(
  overrides: Partial<ResolvedAgentPolicyRule> & {
    action_type: string;
    tier: AgentPolicyTier;
  },
): ResolvedAgentPolicyRule {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'rule-1',
    version: 1,
    enabled: true,
    source: 'platform',
    conditions: {},
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('evaluateAgentPolicy', () => {
  it.each(floorCases)(
    'returns HUMAN_ONLY for floor action %s even when rule tier is AUTO',
    (actionType) => {
      const result = evaluateAgentPolicy(
        actionType,
        {},
        rule({ action_type: actionType, tier: AgentPolicyTier.AUTO }),
      );

      expect(result.tier).toBe(AgentPolicyTier.HUMAN_ONLY);
      expect(result.reasons).toContain('hard_floor_category');
    },
  );

  it('returns HUMAN_ONLY for unknown actions (fail closed)', () => {
    const result = evaluateAgentPolicy('unknown.action', {}, null);

    expect(result.tier).toBe(AgentPolicyTier.HUMAN_ONLY);
    expect(result.reasons).toContain('unknown_action_fail_closed');
  });

  it('escalates AUTO to PROPOSE when amount exceeds threshold', () => {
    const result = evaluateAgentPolicy(
      'workshop_order.add_line',
      { amount_eur: 750 },
      rule({
        action_type: 'workshop_order.add_line',
        tier: AgentPolicyTier.AUTO,
        conditions: { amount_max: 500 },
      }),
    );

    expect(result.tier).toBe(AgentPolicyTier.PROPOSE);
    expect(result.reasons).toContain('amount_above_threshold');
  });

  it('escalates to PROPOSE for customer-facing context', () => {
    const result = evaluateAgentPolicy(
      'workshop_order.add_line',
      { customer_facing: true },
      rule({
        action_type: 'workshop_order.add_line',
        tier: AgentPolicyTier.AUTO,
        conditions: {},
      }),
    );

    expect(result.tier).toBe(AgentPolicyTier.PROPOSE);
    expect(result.reasons).toContain('customer_facing_requires_propose');
  });
});
