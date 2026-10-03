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
  'sales_order.delete',
  'consent.grant',
  'user.role_change',
  'invoice.finalize_batch',
  'vat.update_wording',
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

  it('returns HUMAN_ONLY when the latest rule version is disabled', () => {
    const disabled = rule({
      action_type: 'workshop_order.add_line',
      tier: AgentPolicyTier.AUTO,
      enabled: false,
      id: 'rule-v2',
      version: 2,
    });

    const result = evaluateAgentPolicy('workshop_order.add_line', {}, disabled);

    expect(result.tier).toBe(AgentPolicyTier.HUMAN_ONLY);
    expect(result.reasons).toContain('rule_disabled_fail_closed');
    expect(result.rule_id).toBe('rule-v2');
    expect(result.rule_version).toBe(2);
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

  it('escalates to PROPOSE when rule conditions are customer-facing', () => {
    const result = evaluateAgentPolicy(
      'workshop_order.add_line',
      {},
      rule({
        action_type: 'workshop_order.add_line',
        tier: AgentPolicyTier.AUTO,
        conditions: { customer_facing: true },
      }),
    );

    expect(result.tier).toBe(AgentPolicyTier.PROPOSE);
    expect(result.reasons).toContain('customer_facing_requires_propose');
  });
});
