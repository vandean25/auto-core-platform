import { AgentPolicyTier } from '@prisma/client';
import {
  latestRowPerAction,
  mergeEffectiveRules,
  toResolvedRule,
} from './agent-policy-rule.util.js';
import type { AgentPolicyRuleRow } from './agent-policy-rule.util.js';

const NOW = new Date('2026-10-01T00:00:00.000Z');

function row(overrides: Partial<AgentPolicyRuleRow> = {}): AgentPolicyRuleRow {
  return {
    id: 'rule-1',
    tenant_id: null,
    action_type: 'inventory.part_reserve',
    tier: AgentPolicyTier.AUTO,
    conditions_json: { amount_max: 250 },
    enabled: true,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('toResolvedRule', () => {
  it('maps a stored row and keeps only the known condition keys', () => {
    expect(
      toResolvedRule(
        row({
          conditions_json: { amount_max: 100, reversible: true, extra: 'x' },
        }),
        'tenant',
      ),
    ).toEqual({
      id: 'rule-1',
      version: 1,
      action_type: 'inventory.part_reserve',
      tier: AgentPolicyTier.AUTO,
      conditions: { amount_max: 100, reversible: true },
      enabled: true,
      source: 'tenant',
      created_at: NOW,
      updated_at: NOW,
    });
  });

  it('treats non-object conditions as empty', () => {
    expect(
      toResolvedRule(
        row({ conditions_json: ['not', 'an', 'object'] }),
        'platform',
      ).conditions,
    ).toEqual({});
  });
});

describe('latestRowPerAction', () => {
  it('keeps the first row of each action type, the newest when rows arrive version-descending', () => {
    const rows = [
      row({ id: 'a-v2', action_type: 'a', version: 2 }),
      row({ id: 'a-v1', action_type: 'a', version: 1 }),
      row({ id: 'b-v1', action_type: 'b', version: 1 }),
    ];

    expect(latestRowPerAction(rows).map((item) => item.id)).toEqual([
      'a-v2',
      'b-v1',
    ]);
  });

  it('returns an empty list when there are no rows', () => {
    expect(latestRowPerAction([])).toEqual([]);
  });
});

describe('mergeEffectiveRules', () => {
  it('prefers the tenant row for an action and falls back to the platform row otherwise', () => {
    const merged = mergeEffectiveRules(
      [
        row({ id: 'platform-a', action_type: 'a' }),
        row({ id: 'platform-b', action_type: 'b' }),
      ],
      [
        row({
          id: 'tenant-a',
          action_type: 'a',
          tenant_id: 'tenant-1',
          version: 2,
        }),
      ],
    );

    expect(
      merged.map(({ id, source, version }) => ({ id, source, version })),
    ).toEqual([
      { id: 'tenant-a', source: 'tenant', version: 2 },
      { id: 'platform-b', source: 'platform', version: 1 },
    ]);
  });

  it('sorts by plain code-unit order, so uppercase sorts before lowercase as the list always has', () => {
    const merged = mergeEffectiveRules(
      [row({ action_type: 'b.rule' }), row({ action_type: 'a.rule' })],
      [row({ action_type: 'Z.rule', tenant_id: 'tenant-1' })],
    );

    expect(merged.map((rule) => rule.action_type)).toEqual([
      'Z.rule',
      'a.rule',
      'b.rule',
    ]);
  });
});
