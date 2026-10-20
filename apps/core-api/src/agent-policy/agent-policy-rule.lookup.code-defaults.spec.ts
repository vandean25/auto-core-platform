import { AgentPolicyTier } from '@prisma/client';
import { loadEffectiveRules } from './agent-policy-rule.load-effective.js';
import {
  buildRuleDeps,
  ruleRow,
  TENANT_ID,
} from './agent-policy-rule.spec.support.js';

describe('agent-policy-rule.load loadEffectiveRules', () => {
  it('merges platform defaults with tenant overrides and appends code defaults', async () => {
    const { deps, prisma, systemPrisma } = buildRuleDeps();
    systemPrisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({ id: 'platform-b', action_type: 'b.action' }),
      ruleRow({ id: 'platform-a', action_type: 'a.action' }),
    ]);
    prisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({
        id: 'tenant-b',
        tenant_id: TENANT_ID,
        action_type: 'b.action',
        version: 2,
      }),
    ]);

    const effective = await loadEffectiveRules(deps, TENANT_ID);

    expect(
      effective.map((rule) => [rule.action_type, rule.source, rule.id]),
    ).toEqual([
      ['a.action', 'platform', 'platform-a'],
      ['b.action', 'tenant', 'tenant-b'],
      ['customer.create', 'platform', 'code-default:customer.create'],
      ['customer.update', 'platform', 'code-default:customer.update'],
    ]);
  });
});

describe('agent-policy-rule.lookup code defaults in listRules', () => {
  it('lists code defaults when no stored row exists for that action', async () => {
    const { deps, systemPrisma } = buildRuleDeps();
    systemPrisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({
        id: 'platform-row',
        action_type: 'customer.create',
        tier: AgentPolicyTier.HUMAN_ONLY,
      }),
    ]);

    const effective = await loadEffectiveRules(deps, TENANT_ID);

    expect(
      effective.find((rule) => rule.action_type === 'customer.create'),
    ).toMatchObject({ id: 'platform-row', tier: AgentPolicyTier.HUMAN_ONLY });
    expect(
      effective.find((rule) => rule.action_type === 'customer.update'),
    ).toMatchObject({
      id: 'code-default:customer.update',
      tier: AgentPolicyTier.PROPOSE,
      enabled: false,
      source: 'platform',
    });
  });

  it('lists both customer code defaults when neither has a stored row', async () => {
    const { deps } = buildRuleDeps();

    const effective = await loadEffectiveRules(deps, TENANT_ID);

    expect(
      effective.find((rule) => rule.action_type === 'customer.create'),
    ).toMatchObject({
      id: 'code-default:customer.create',
      tier: AgentPolicyTier.PROPOSE,
      enabled: false,
    });
    expect(
      effective.find((rule) => rule.action_type === 'customer.update'),
    ).toMatchObject({
      id: 'code-default:customer.update',
      tier: AgentPolicyTier.PROPOSE,
      enabled: false,
    });
  });
});
