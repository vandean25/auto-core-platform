import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import {
  ACTION_TYPE,
  TENANT_ID,
  buildHarness,
  expectedDto,
  expectListRulesIncludesCustomerDefaults,
  expectRejection,
  ruleRow,
} from './agent-policy.service.spec.support.js';

describe('AgentPolicyService.listRules', () => {
  it('returns one effective rule per action type, sorted, with tenant overrides winning', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({ id: 'platform-ipr' }),
      ruleRow({
        id: 'platform-wo',
        action_type: 'workshop_order.create',
        tier: AgentPolicyTier.PROPOSE,
        conditions_json: {},
      }),
    ]);
    h.prisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({
        id: 'tenant-ipr',
        tenant_id: TENANT_ID,
        tier: AgentPolicyTier.HUMAN_ONLY,
        conditions_json: { amount_max: 100 },
        enabled: false,
        version: 2,
      }),
    ]);

    const { data } = await h.service.listRules();
    expectListRulesIncludesCustomerDefaults(data);
    expect(data.slice(2)).toEqual([
      expectedDto({
        id: 'tenant-ipr',
        tier: AgentPolicyTier.HUMAN_ONLY,
        conditions: { amount_max: 100 },
        enabled: false,
        version: 2,
        source: 'tenant',
      }),
      expectedDto({
        id: 'platform-wo',
        action_type: 'workshop_order.create',
        tier: AgentPolicyTier.PROPOSE,
        conditions: {},
      }),
    ]);
  });

  it('sorts the effective rules by action type even when the rows arrive unsorted', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({
        id: 'platform-wo',
        action_type: 'workshop_order.create',
        conditions_json: {},
      }),
      ruleRow({ id: 'platform-ipr' }),
    ]);

    const { data } = await h.service.listRules();
    expectListRulesIncludesCustomerDefaults(data);

    expect(data.map((rule) => rule.action_type)).toEqual([
      'customer.create',
      'customer.update',
      ACTION_TYPE,
      'workshop_order.create',
    ]);
  });

  it('orders mixed-case action types by code unit, as the list has always done', async () => {
    const h = buildHarness();
    h.prisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({ id: 't-b', tenant_id: TENANT_ID, action_type: 'b.rule' }),
      ruleRow({ id: 't-a', tenant_id: TENANT_ID, action_type: 'a.rule' }),
      ruleRow({ id: 't-upper', tenant_id: TENANT_ID, action_type: 'Z.rule' }),
    ]);

    const { data } = await h.service.listRules();
    expectListRulesIncludesCustomerDefaults(data);

    expect(data.map((rule) => rule.action_type)).toEqual([
      'Z.rule',
      'a.rule',
      'b.rule',
      'customer.create',
      'customer.update',
    ]);
  });

  it('keeps only the newest platform version when the tenant has no override', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({ id: 'platform-v3', version: 3, tier: AgentPolicyTier.PROPOSE }),
      ruleRow({ id: 'platform-v2', version: 2 }),
      ruleRow({ id: 'platform-v1', version: 1 }),
    ]);

    const { data } = await h.service.listRules();
    expectListRulesIncludesCustomerDefaults(data);
    expect(data.slice(2)).toEqual([
      expectedDto({
        id: 'platform-v3',
        tier: AgentPolicyTier.PROPOSE,
        version: 3,
      }),
    ]);
  });

  it('keeps only the newest tenant version when the tenant overrides', async () => {
    const h = buildHarness();
    h.prisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({
        id: 'tenant-v2',
        tenant_id: TENANT_ID,
        version: 2,
        tier: AgentPolicyTier.HUMAN_ONLY,
      }),
      ruleRow({ id: 'tenant-v1', tenant_id: TENANT_ID, version: 1 }),
    ]);

    const { data } = await h.service.listRules();
    expectListRulesIncludesCustomerDefaults(data);
    expect(data.slice(2)).toEqual([
      expectedDto({
        id: 'tenant-v2',
        tier: AgentPolicyTier.HUMAN_ONLY,
        version: 2,
        source: 'tenant',
      }),
    ]);
  });

  it('includes tenant-only actions that have no platform default, tagged as tenant', async () => {
    const h = buildHarness();
    h.prisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({
        id: 'tenant-custom',
        tenant_id: TENANT_ID,
        action_type: 'custom.tenant_only',
        conditions_json: {},
      }),
    ]);

    const { data } = await h.service.listRules();
    expectListRulesIncludesCustomerDefaults(data);
    expect(
      data.find((rule) => rule.action_type === 'custom.tenant_only'),
    ).toEqual(
      expectedDto({
        id: 'tenant-custom',
        action_type: 'custom.tenant_only',
        conditions: {},
        source: 'tenant',
      }),
    );
  });

  it('returns customer code defaults when no stored rules exist', async () => {
    const h = buildHarness();

    const { data } = await h.service.listRules();
    expectListRulesIncludesCustomerDefaults(data);
    expect(data).toHaveLength(2);
  });

  it.each(['ADMIN', 'OWNER'])('allows %s callers', async (role) => {
    const h = buildHarness({ role });

    const { data } = await h.service.listRules();
    expectListRulesIncludesCustomerDefaults(data);
    expect(data).toHaveLength(2);
  });

  it.each(['SALES', null])(
    'rejects %s callers before reading any rules',
    async (role) => {
      const h = buildHarness({ role });

      await expectRejection(h.service.listRules(), ForbiddenException, {
        message: 'Tenant admin access is required.',
      });
      expect(h.tenantContext.getTenantId).not.toHaveBeenCalled();
      expect(h.prisma.agentPolicyRule.findMany).not.toHaveBeenCalled();
      expect(h.systemPrisma.agentPolicyRule.findMany).not.toHaveBeenCalled();
    },
  );
});

describe('AgentPolicyService code platform defaults', () => {
  it('resolves the code default of a customer action when no row exists', async () => {
    const h = buildHarness();

    await expect(
      h.service.getEffectiveRule('customer.create'),
    ).resolves.toMatchObject({
      id: 'code-default:customer.create',
      tier: AgentPolicyTier.PROPOSE,
      enabled: false,
      source: 'platform',
    });
  });

  it('lets a tenant admin enable a customer action at PROPOSE', async () => {
    const h = buildHarness();

    await expect(
      h.service.upsertRule('customer.create', { tier: AgentPolicyTier.PROPOSE }),
    ).resolves.toMatchObject({
      action_type: 'customer.create',
      tier: AgentPolicyTier.PROPOSE,
      source: 'tenant',
    });
    expect(h.tx.agentPolicyRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action_type: 'customer.create',
        tier: AgentPolicyTier.PROPOSE,
      }),
    });
  });

  it('holds a customer action at PROPOSE, so the tenant cannot choose AUTO', async () => {
    const h = buildHarness();

    const error = await h.service
      .upsertRule('customer.create', { tier: AgentPolicyTier.AUTO })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'AGENT_POLICY_LOOSER_THAN_PLATFORM',
      message:
        'Tenant policy tier must be at least as strict as the platform default.',
    });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed while the code default is off', async () => {
    const h = buildHarness();

    await expect(h.service.evaluateAction('customer.create')).resolves.toMatchObject({
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['rule_disabled_fail_closed'],
    });
  });
});

