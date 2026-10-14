import { BadRequestException } from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import { AGENT_POLICY_ERROR_CODES } from './agent-policy.constants.js';
import {
  loadEffectiveRules,
  requirePlatformRule,
  resolveEffectiveRule,
} from './agent-policy-rule.lookup.js';
import {
  ACTION_TYPE,
  buildRuleDeps,
  ruleRow,
  TENANT_ID,
} from './agent-policy-rule.spec.support.js';

describe('agent-policy-rule.lookup resolveEffectiveRule', () => {
  it('prefers the tenant override and does not read the platform row', async () => {
    const { deps, prisma, systemPrisma } = buildRuleDeps();
    prisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({
        id: 'tenant-row-2',
        tenant_id: TENANT_ID,
        tier: AgentPolicyTier.PROPOSE,
        version: 2,
      }),
    );

    await expect(
      resolveEffectiveRule(deps, TENANT_ID, ACTION_TYPE),
    ).resolves.toMatchObject({
      id: 'tenant-row-2',
      tier: AgentPolicyTier.PROPOSE,
      version: 2,
      source: 'tenant',
    });
    expect(systemPrisma.agentPolicyRule.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to the platform default when the tenant has no override', async () => {
    const { deps, systemPrisma } = buildRuleDeps();
    systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await expect(
      resolveEffectiveRule(deps, TENANT_ID, ACTION_TYPE),
    ).resolves.toMatchObject({
      id: 'rule-row-1',
      tier: AgentPolicyTier.AUTO,
      source: 'platform',
    });
  });

  it('returns null when neither scope defines the action', async () => {
    const { deps } = buildRuleDeps();

    await expect(
      resolveEffectiveRule(deps, TENANT_ID, ACTION_TYPE),
    ).resolves.toBeNull();
  });
});

describe('agent-policy-rule.lookup requirePlatformRule', () => {
  it('returns the platform default for a known action', async () => {
    const { deps, systemPrisma } = buildRuleDeps();
    systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await expect(requirePlatformRule(deps, ACTION_TYPE)).resolves.toMatchObject(
      {
        tier: AgentPolicyTier.AUTO,
        source: 'platform',
      },
    );
  });

  it('rejects an action the platform does not define', async () => {
    const { deps } = buildRuleDeps();

    const error = await requirePlatformRule(deps, 'unknown.action').catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      code: AGENT_POLICY_ERROR_CODES.UNKNOWN_ACTION_TYPE,
      message: 'Unknown action type: unknown.action',
    });
  });
});

describe('agent-policy-rule.lookup loadEffectiveRules', () => {
  it('merges platform defaults with tenant overrides, one rule per action, sorted by action type', async () => {
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
    ]);
  });
});
