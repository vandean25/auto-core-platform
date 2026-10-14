import { ConflictException } from '@nestjs/common';
import { AgentPolicyTier, AuditLogAction, Prisma } from '@prisma/client';
import { AGENT_POLICY_ERROR_CODES } from './agent-policy.constants.js';
import {
  createTenantRuleVersion,
  findLatestPlatformRow,
  findLatestTenantRow,
  findPlatformRuleRows,
  findTenantRuleRows,
  type NewTenantRuleVersion,
} from './agent-policy-rule.store.js';
import {
  ACTION_TYPE,
  buildRuleDeps,
  ruleRow,
  TENANT_ID,
} from './agent-policy-rule.spec.support.js';

const USER_ROW_ID = 'user-row-1';
const NEW_ROW_ID = 'tenant-row-new';
const NOW = new Date('2026-10-02T00:00:00.000Z');

function versionInput(
  overrides: Partial<NewTenantRuleVersion> = {},
): NewTenantRuleVersion {
  return {
    tenantId: TENANT_ID,
    actionType: ACTION_TYPE,
    tier: AgentPolicyTier.PROPOSE,
    conditions: { amount_max: 100 },
    enabled: true,
    version: 2,
    actorUserId: USER_ROW_ID,
    before: {
      action_type: ACTION_TYPE,
      tier: AgentPolicyTier.AUTO,
      conditions: { amount_max: 250 },
      enabled: true,
      version: 1,
      source: 'platform',
    },
    ...overrides,
  };
}

describe('agent-policy-rule.store queries', () => {
  it('reads the tenant rows in list order, scoped to the tenant', async () => {
    const { deps, prisma } = buildRuleDeps();
    const rows = [ruleRow({ tenant_id: TENANT_ID, id: 'tenant-row-1' })];
    prisma.agentPolicyRule.findMany.mockResolvedValue(rows);

    await expect(findTenantRuleRows(deps, TENANT_ID)).resolves.toBe(rows);
    expect(prisma.agentPolicyRule.findMany).toHaveBeenCalledWith({
      where: { tenant_id: TENANT_ID },
      orderBy: [{ action_type: 'asc' }, { version: 'desc' }],
    });
  });

  it('reads only the platform rows (tenant_id null) in list order', async () => {
    const { deps, systemPrisma } = buildRuleDeps();
    const rows = [ruleRow()];
    systemPrisma.agentPolicyRule.findMany.mockResolvedValue(rows);

    await expect(findPlatformRuleRows(deps)).resolves.toBe(rows);
    expect(systemPrisma.agentPolicyRule.findMany).toHaveBeenCalledWith({
      where: { tenant_id: null },
      orderBy: [{ action_type: 'asc' }, { version: 'desc' }],
    });
  });

  it('finds the newest tenant row for an action, scoped to the tenant', async () => {
    const { deps, prisma } = buildRuleDeps();
    const row = ruleRow({ tenant_id: TENANT_ID, version: 3 });
    prisma.agentPolicyRule.findFirst.mockResolvedValue(row);

    await expect(
      findLatestTenantRow(deps, TENANT_ID, ACTION_TYPE),
    ).resolves.toBe(row);
    expect(prisma.agentPolicyRule.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: TENANT_ID, action_type: ACTION_TYPE },
      orderBy: { version: 'desc' },
    });
  });

  it('finds the newest platform row for an action', async () => {
    const { deps, systemPrisma } = buildRuleDeps();
    const row = ruleRow({ version: 4 });
    systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(row);

    await expect(findLatestPlatformRow(deps, ACTION_TYPE)).resolves.toBe(row);
    expect(systemPrisma.agentPolicyRule.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: null, action_type: ACTION_TYPE },
      orderBy: { version: 'desc' },
    });
  });

  it('returns null when no row matches the action', async () => {
    const { deps } = buildRuleDeps();

    await expect(
      findLatestTenantRow(deps, TENANT_ID, ACTION_TYPE),
    ).resolves.toBeNull();
    await expect(findLatestPlatformRow(deps, ACTION_TYPE)).resolves.toBeNull();
  });
});

describe('agent-policy-rule.store createTenantRuleVersion', () => {
  function buildWritableDeps() {
    const tx = {
      agentPolicyRule: {
        create: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            id: NEW_ROW_ID,
            created_at: NOW,
            updated_at: NOW,
            ...data,
          }),
        ),
      },
    };
    const h = buildRuleDeps();
    h.prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    return { ...h, tx };
  }

  it('writes the version and its audit entry in one transaction', async () => {
    const { deps, prisma, auditService, tx } = buildWritableDeps();

    const row = await createTenantRuleVersion(deps, versionInput());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.agentPolicyRule.create).toHaveBeenCalledWith({
      data: {
        tenant_id: TENANT_ID,
        action_type: ACTION_TYPE,
        tier: AgentPolicyTier.PROPOSE,
        conditions_json: { amount_max: 100 },
        enabled: true,
        version: 2,
        created_by: USER_ROW_ID,
      },
    });
    expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'AgentPolicyRule',
        entityId: NEW_ROW_ID,
        action: AuditLogAction.UPDATE,
        actorUserId: USER_ROW_ID,
        source: 'agent_policy',
        diff: {
          tier: {
            before: AgentPolicyTier.AUTO,
            after: AgentPolicyTier.PROPOSE,
          },
          version: { before: 1, after: 2 },
        },
      }),
      tx,
    );
    expect(row).toMatchObject({
      id: NEW_ROW_ID,
      tenant_id: TENANT_ID,
      tier: AgentPolicyTier.PROPOSE,
      version: 2,
    });
  });

  it('maps a unique version violation to a version conflict', async () => {
    const { deps, prisma, auditService } = buildWritableDeps();
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    const error = await createTenantRuleVersion(deps, versionInput()).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: AGENT_POLICY_ERROR_CODES.VERSION_CONFLICT,
    });
    expect(auditService.recordTenantMutation).not.toHaveBeenCalled();
  });

  it('rethrows any other failure unchanged', async () => {
    const { deps, prisma } = buildWritableDeps();
    const failure = new Error('connection terminated');
    prisma.$transaction.mockRejectedValue(failure);

    await expect(createTenantRuleVersion(deps, versionInput())).rejects.toBe(
      failure,
    );
  });
});
