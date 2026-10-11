import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgentPolicyTier, AuditLogAction, Prisma } from '@prisma/client';
import type { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { AgentPolicyService } from './agent-policy.service.js';
import type {
  AgentPolicyEvaluateRequestDto,
  UpsertAgentPolicyRuleDto,
} from './dto/agent-policy.dto.js';

const TENANT_ID = 'tenant-1';
const ACTION_TYPE = 'inventory.part_reserve';
const FIREBASE_UID = 'firebase-uid-1';

function ruleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-row-1',
    tenant_id: null,
    action_type: ACTION_TYPE,
    tier: AgentPolicyTier.AUTO,
    conditions_json: { amount_max: 250 },
    enabled: true,
    version: 1,
    created_at: new Date('2026-10-01T00:00:00.000Z'),
    updated_at: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createService() {
  const tenantFindFirst = jest.fn();
  const platformFindFirst = jest.fn();
  const prisma = {
    agentPolicyRule: { findFirst: tenantFindFirst },
  } as unknown as PrismaService;
  const systemPrisma = {
    agentPolicyRule: { findFirst: platformFindFirst },
  } as unknown as SystemPrismaService;
  const tenantContext = new TenantContextService();
  const service = new AgentPolicyService(
    prisma,
    systemPrisma,
    tenantContext,
    {} as unknown as AuditService,
  );
  return { service, tenantContext, tenantFindFirst, platformFindFirst };
}

function runAsRole(
  tenantContext: TenantContextService,
  role: string,
  callback: () => Promise<void>,
) {
  return TenantContextStorage.run(async () => {
    tenantContext.setAuthenticatedUser({
      userId: FIREBASE_UID,
      email: 'user@example.invalid',
      tenantId: TENANT_ID,
      role,
    });
    await callback();
  });
}

const OTHER_TENANT_ID = 'tenant-2';
const USER_ROW_ID = 'user-row-1';
const NEW_ROW_ID = 'tenant-row-new';
const ROW_TIMESTAMP = '2026-10-01T00:00:00.000Z';
const NOW = new Date('2026-10-02T00:00:00.000Z');

/**
 * Service wired to jest doubles for Prisma, the system client, audit and the
 * tenant context, so each test states the exact rows and identity it needs.
 * Transactions run the callback against `tx`, whose create echoes the data back
 * as a stored row.
 */
function buildHarness({
  role = 'ADMIN',
  tenantId = TENANT_ID,
}: { role?: string | null; tenantId?: string } = {}) {
  const tx = {
    agentPolicyRule: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: NEW_ROW_ID,
        created_at: NOW,
        updated_at: NOW,
        ...data,
      })),
    },
  };
  const prisma = {
    agentPolicyRule: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ id: USER_ROW_ID }) },
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const systemPrisma = {
    agentPolicyRule: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const audit = {
    recordTenantMutation: jest.fn().mockResolvedValue(undefined),
  };
  const authUser =
    role === null
      ? undefined
      : { userId: FIREBASE_UID, email: 'user@example.invalid', tenantId, role };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
    getAuthenticatedUser: jest.fn().mockReturnValue(authUser),
  };
  const service = new AgentPolicyService(
    prisma as unknown as PrismaService,
    systemPrisma as unknown as SystemPrismaService,
    tenantContext as unknown as TenantContextService,
    audit as unknown as AuditService,
  );
  return { service, prisma, systemPrisma, audit, tx, tenantContext };
}

type Harness = ReturnType<typeof buildHarness>;

type HttpExceptionType = new (...args: never[]) => HttpException;

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to reject');
}

async function expectRejection(
  promise: Promise<unknown>,
  type: HttpExceptionType,
  response: object,
): Promise<void> {
  const error = await captureRejection(promise);
  expect(error).toBeInstanceOf(type);
  expect((error as HttpException).getResponse()).toMatchObject(response);
}

/** A rejection that must happen before any transaction opens. */
async function expectRejectedWithoutWrite(
  h: Harness,
  promise: Promise<unknown>,
  type: HttpExceptionType,
  response: object,
): Promise<void> {
  await expectRejection(promise, type, response);
  expect(h.prisma.$transaction).not.toHaveBeenCalled();
}

function expectRuleWritten(h: Harness, data: Record<string, unknown>): void {
  expect(h.tx.agentPolicyRule.create).toHaveBeenCalledWith({
    data: expect.objectContaining(data),
  });
}

/** Body validation rejects before the membership lookup runs. */
async function expectValidationBeforeMembership(
  platform: Record<string, unknown>,
  body: UpsertAgentPolicyRuleDto,
  response: object,
): Promise<void> {
  const h = buildHarness();
  h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow(platform));
  h.prisma.user.findUnique.mockResolvedValue(null);

  await expectRejection(
    h.service.upsertRule(ACTION_TYPE, body),
    UnprocessableEntityException,
    response,
  );
  expect(h.prisma.user.findUnique).not.toHaveBeenCalled();
}

function expectLatestRuleLookup(
  query: jest.Mock,
  where: Record<string, unknown>,
): void {
  expect(query).toHaveBeenCalledWith({ where, orderBy: { version: 'desc' } });
}

/** A tenant override at `tier` is accepted and written as a tenant-source rule. */
async function expectOverrideAccepted(
  h: Harness,
  tier: AgentPolicyTier,
): Promise<void> {
  await expect(h.service.upsertRule(ACTION_TYPE, { tier })).resolves.toMatchObject(
    { tier, source: 'tenant' },
  );
  expectRuleWritten(h, { tier });
}

/** The DTO a row with `ruleRow()` defaults maps to, with per-test overrides. */
function expectedDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-row-1',
    action_type: ACTION_TYPE,
    tier: AgentPolicyTier.AUTO,
    conditions: { amount_max: 250 },
    enabled: true,
    version: 1,
    source: 'platform',
    created_at: ROW_TIMESTAMP,
    updated_at: ROW_TIMESTAMP,
    ...overrides,
  };
}

/** An audit snapshot of the rule on `ACTION_TYPE`, with per-test overrides. */
function snapshot(fields: Record<string, unknown>) {
  return { action_type: ACTION_TYPE, enabled: true, ...fields };
}

/** The UPDATE audit entry the upsert writes for a before/after pair. */
function auditEntry(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return {
    entityType: 'AgentPolicyRule',
    entityId: NEW_ROW_ID,
    action: AuditLogAction.UPDATE,
    actorUserId: USER_ROW_ID,
    source: 'agent_policy',
    before,
    after,
    diff: {
      tier: { before: before.tier, after: after.tier },
      version: { before: before.version, after: after.version },
    },
  };
}
describe('AgentPolicyService.getEffectiveRule', () => {
  it('prefers the tenant override over the platform default', async () => {
    const { service, tenantContext, tenantFindFirst, platformFindFirst } =
      createService();
    tenantFindFirst.mockResolvedValue(
      ruleRow({
        id: 'tenant-row-2',
        tenant_id: TENANT_ID,
        tier: AgentPolicyTier.PROPOSE,
        enabled: false,
        version: 2,
      }),
    );

    await runAsRole(tenantContext, 'ADMIN', async () => {
      await expect(service.getEffectiveRule(ACTION_TYPE)).resolves.toMatchObject(
        {
          id: 'tenant-row-2',
          tier: AgentPolicyTier.PROPOSE,
          enabled: false,
          source: 'tenant',
        },
      );
    });

    expect(platformFindFirst).not.toHaveBeenCalled();
  });

  it('falls back to the platform default when the tenant has no override', async () => {
    const { service, tenantContext, tenantFindFirst, platformFindFirst } =
      createService();
    tenantFindFirst.mockResolvedValue(null);
    platformFindFirst.mockResolvedValue(ruleRow());

    await runAsRole(tenantContext, 'ADMIN', async () => {
      await expect(service.getEffectiveRule(ACTION_TYPE)).resolves.toMatchObject(
        {
          tier: AgentPolicyTier.AUTO,
          enabled: true,
          source: 'platform',
        },
      );
    });
  });

  it('returns null when neither a tenant override nor a platform default exists', async () => {
    const { service, tenantContext, tenantFindFirst, platformFindFirst } =
      createService();
    tenantFindFirst.mockResolvedValue(null);
    platformFindFirst.mockResolvedValue(null);

    await runAsRole(tenantContext, 'ADMIN', async () => {
      await expect(service.getEffectiveRule(ACTION_TYPE)).resolves.toBeNull();
    });
  });

  it('reads only the active tenant override', async () => {
    const { service, tenantContext, tenantFindFirst, platformFindFirst } =
      createService();
    tenantFindFirst.mockResolvedValue(null);
    platformFindFirst.mockResolvedValue(ruleRow());

    await runAsRole(tenantContext, 'ADMIN', async () => {
      await service.getEffectiveRule(ACTION_TYPE);
    });

    expect(tenantFindFirst).toHaveBeenCalledWith({
      where: { tenant_id: TENANT_ID, action_type: ACTION_TYPE },
      orderBy: { version: 'desc' },
    });
    expect(platformFindFirst).toHaveBeenCalledWith({
      where: { tenant_id: null, action_type: ACTION_TYPE },
      orderBy: { version: 'desc' },
    });
  });

  it('is available to non-admin agent callers', async () => {
    const { service, tenantContext, tenantFindFirst, platformFindFirst } =
      createService();
    tenantFindFirst.mockResolvedValue(null);
    platformFindFirst.mockResolvedValue(ruleRow());

    await runAsRole(tenantContext, 'SALES', async () => {
      await expect(service.getEffectiveRule(ACTION_TYPE)).resolves.toMatchObject(
        { source: 'platform' },
      );
    });
  });
});

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

    await expect(h.service.listRules()).resolves.toEqual({
      data: [
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
      ],
    });
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

    expect(data.map((rule) => rule.action_type)).toEqual([
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

    expect(data.map((rule) => rule.action_type)).toEqual([
      'Z.rule',
      'a.rule',
      'b.rule',
    ]);
  });

  it('keeps only the newest platform version when the tenant has no override', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findMany.mockResolvedValue([
      ruleRow({ id: 'platform-v3', version: 3, tier: AgentPolicyTier.PROPOSE }),
      ruleRow({ id: 'platform-v2', version: 2 }),
      ruleRow({ id: 'platform-v1', version: 1 }),
    ]);

    await expect(h.service.listRules()).resolves.toEqual({
      data: [
        expectedDto({
          id: 'platform-v3',
          tier: AgentPolicyTier.PROPOSE,
          version: 3,
        }),
      ],
    });
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

    await expect(h.service.listRules()).resolves.toEqual({
      data: [
        expectedDto({
          id: 'tenant-v2',
          tier: AgentPolicyTier.HUMAN_ONLY,
          version: 2,
          source: 'tenant',
        }),
      ],
    });
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

    await expect(h.service.listRules()).resolves.toEqual({
      data: [
        expectedDto({
          id: 'tenant-custom',
          action_type: 'custom.tenant_only',
          conditions: {},
          source: 'tenant',
        }),
      ],
    });
  });

  it('returns an empty list when no rules exist', async () => {
    const h = buildHarness();

    await expect(h.service.listRules()).resolves.toEqual({ data: [] });
  });

  it.each(['ADMIN', 'OWNER'])('allows %s callers', async (role) => {
    const h = buildHarness({ role });

    await expect(h.service.listRules()).resolves.toEqual({ data: [] });
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

describe('AgentPolicyService.upsertRule', () => {
  it('rejects non-admin callers before any lookup or write', async () => {
    const h = buildHarness({ role: 'SALES' });

    await expectRejection(
      h.service.upsertRule(ACTION_TYPE, { tier: AgentPolicyTier.PROPOSE }),
      ForbiddenException,
      { message: 'Tenant admin access is required.' },
    );
    expect(h.tenantContext.getTenantId).not.toHaveBeenCalled();
    expect(h.systemPrisma.agentPolicyRule.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a blank action type with 400 before any lookup', async () => {
    const h = buildHarness();

    await expectRejection(
      h.service.upsertRule('   ', { tier: AgentPolicyTier.PROPOSE }),
      BadRequestException,
      { message: 'action_type is required' },
    );
    expect(h.systemPrisma.agentPolicyRule.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an action type without a platform default with the unknown-action code', async () => {
    const h = buildHarness();

    await expectRejectedWithoutWrite(
      h,
      h.service.upsertRule('made.up', { tier: AgentPolicyTier.PROPOSE }),
      BadRequestException,
      {
        code: 'AGENT_POLICY_UNKNOWN_ACTION_TYPE',
        message: 'Unknown action type: made.up',
      },
    );
  });

  it('trims the action type before the platform lookup and before writing', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await h.service.upsertRule('  inventory.part_reserve  ', {
      tier: AgentPolicyTier.PROPOSE,
    });

    expectLatestRuleLookup(h.systemPrisma.agentPolicyRule.findFirst, {
      tenant_id: null,
      action_type: ACTION_TYPE,
    });
    expectRuleWritten(h, { action_type: ACTION_TYPE });
  });

  it.each([
    [AgentPolicyTier.AUTO, AgentPolicyTier.PROPOSE],
    [AgentPolicyTier.AUTO, AgentPolicyTier.HUMAN_ONLY],
    [AgentPolicyTier.PROPOSE, AgentPolicyTier.HUMAN_ONLY],
  ])(
    'rejects a %s tier when the platform default is %s',
    async (tier, platformTier) => {
      const h = buildHarness();
      h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(
        ruleRow({ tier: platformTier }),
      );

      await expectRejectedWithoutWrite(
        h,
        h.service.upsertRule(ACTION_TYPE, { tier }),
        UnprocessableEntityException,
        {
          code: 'AGENT_POLICY_LOOSER_THAN_PLATFORM',
          message:
            'Tenant policy tier must be at least as strict as the platform default.',
        },
      );
    },
  );

  it.each([
    [AgentPolicyTier.AUTO, AgentPolicyTier.AUTO],
    [AgentPolicyTier.PROPOSE, AgentPolicyTier.AUTO],
    [AgentPolicyTier.HUMAN_ONLY, AgentPolicyTier.AUTO],
    [AgentPolicyTier.PROPOSE, AgentPolicyTier.PROPOSE],
    [AgentPolicyTier.HUMAN_ONLY, AgentPolicyTier.PROPOSE],
    [AgentPolicyTier.HUMAN_ONLY, AgentPolicyTier.HUMAN_ONLY],
  ])(
    'accepts a %s tier when the platform default is %s',
    async (tier, platformTier) => {
      const h = buildHarness();
      h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(
        ruleRow({ tier: platformTier }),
      );

      await expectOverrideAccepted(h, tier);
    },
  );

  it.each([null, 500])(
    'rejects amount_max %s when the platform caps at 250',
    async (amountMax) => {
      const h = buildHarness();
      h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

      await expectRejectedWithoutWrite(
        h,
        h.service.upsertRule(ACTION_TYPE, {
          tier: AgentPolicyTier.AUTO,
          conditions: { amount_max: amountMax },
        }),
        UnprocessableEntityException,
        {
          code: 'AGENT_POLICY_LOOSER_THAN_PLATFORM',
          message:
            'Tenant policy amount_max must be at least as strict as the platform default.',
        },
      );
    },
  );

  it('rejects dropping customer_facing when the platform default requires it', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({ conditions_json: { customer_facing: true } }),
    );

    await expectRejection(
      h.service.upsertRule(ACTION_TYPE, {
        tier: AgentPolicyTier.AUTO,
        conditions: { customer_facing: false },
      }),
      UnprocessableEntityException,
      {
        code: 'AGENT_POLICY_LOOSER_THAN_PLATFORM',
        message:
          'Tenant policy must keep customer_facing when the platform default requires it.',
      },
    );
  });

  it('keeps platform conditions the body does not override', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({ conditions_json: { amount_max: 250, customer_facing: true } }),
    );

    await h.service.upsertRule(ACTION_TYPE, {
      tier: AgentPolicyTier.PROPOSE,
      conditions: { amount_max: 100 },
    });

    expectRuleWritten(h, {
      conditions_json: { amount_max: 100, customer_facing: true },
    });
  });

  it('falls back to platform conditions, not the previous tenant override, when conditions are omitted', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());
    h.prisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({
        id: 'tenant-row-4',
        tenant_id: TENANT_ID,
        version: 4,
        conditions_json: { amount_max: 100 },
      }),
    );

    await h.service.upsertRule(ACTION_TYPE, { tier: AgentPolicyTier.PROPOSE });

    expectRuleWritten(h, { conditions_json: { amount_max: 250 } });
  });

  it('writes the first tenant override as version 1, enabled by default, attributed to the caller', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await h.service.upsertRule(ACTION_TYPE, { tier: AgentPolicyTier.PROPOSE });

    expect(h.tx.agentPolicyRule.create).toHaveBeenCalledWith({
      data: {
        tenant_id: TENANT_ID,
        action_type: ACTION_TYPE,
        tier: AgentPolicyTier.PROPOSE,
        conditions_json: { amount_max: 250 },
        enabled: true,
        version: 1,
        created_by: USER_ROW_ID,
      },
    });
  });

  it('bumps the version from the latest tenant row and keeps enabled: false', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());
    h.prisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({ id: 'tenant-row-4', tenant_id: TENANT_ID, version: 4 }),
    );

    await h.service.upsertRule(ACTION_TYPE, {
      tier: AgentPolicyTier.PROPOSE,
      enabled: false,
    });

    expectRuleWritten(h, { version: 5, enabled: false });
  });

  it('returns the stored override as a tenant-source rule', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await expect(
      h.service.upsertRule(ACTION_TYPE, {
        tier: AgentPolicyTier.PROPOSE,
        conditions: { amount_max: 100 },
      }),
    ).resolves.toEqual({
      id: NEW_ROW_ID,
      action_type: ACTION_TYPE,
      tier: AgentPolicyTier.PROPOSE,
      conditions: { amount_max: 100 },
      enabled: true,
      version: 1,
      source: 'tenant',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
  });

  it('writes an UPDATE audit entry in the same transaction, diffing against the latest tenant row', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());
    h.prisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({
        id: 'tenant-row-4',
        tenant_id: TENANT_ID,
        tier: AgentPolicyTier.PROPOSE,
        conditions_json: { amount_max: 200 },
        version: 4,
      }),
    );

    await h.service.upsertRule(ACTION_TYPE, {
      tier: AgentPolicyTier.HUMAN_ONLY,
    });

    expect(h.audit.recordTenantMutation).toHaveBeenCalledWith(
      auditEntry(
        snapshot({
          tier: AgentPolicyTier.PROPOSE,
          conditions: { amount_max: 200 },
          version: 4,
          source: 'tenant',
        }),
        snapshot({
          tier: AgentPolicyTier.HUMAN_ONLY,
          conditions: { amount_max: 250 },
          version: 5,
          source: 'tenant',
        }),
      ),
      h.tx,
    );
  });

  it('uses the platform default as the audit baseline when the tenant has no override', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await h.service.upsertRule(ACTION_TYPE, {
      tier: AgentPolicyTier.PROPOSE,
      conditions: { amount_max: 100 },
    });

    expect(h.audit.recordTenantMutation).toHaveBeenCalledWith(
      auditEntry(
        snapshot({
          tier: AgentPolicyTier.AUTO,
          conditions: { amount_max: 250 },
          version: 1,
          source: 'platform',
        }),
        snapshot({
          tier: AgentPolicyTier.PROPOSE,
          conditions: { amount_max: 100 },
          version: 1,
          source: 'tenant',
        }),
      ),
      h.tx,
    );
  });

  it('maps a unique violation on the version to 409 AGENT_POLICY_VERSION_CONFLICT', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());
    h.prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );

    await expectRejection(
      h.service.upsertRule(ACTION_TYPE, { tier: AgentPolicyTier.PROPOSE }),
      ConflictException,
      {
        code: 'AGENT_POLICY_VERSION_CONFLICT',
        message:
          'A concurrent update created the same rule version. Retry the request.',
      },
    );
  });

  it('maps the tier-looser database trigger to 422 AGENT_POLICY_LOOSER_THAN_PLATFORM', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());
    h.prisma.$transaction.mockRejectedValue(
      new Error('ERROR: agent_policy_tenant_tier_looser_than_platform'),
    );

    await expectRejection(
      h.service.upsertRule(ACTION_TYPE, { tier: AgentPolicyTier.PROPOSE }),
      UnprocessableEntityException,
      {
        code: 'AGENT_POLICY_LOOSER_THAN_PLATFORM',
        message:
          'Tenant policy must be at least as strict as the platform default.',
      },
    );
  });

  it('rethrows any other persistence failure unchanged', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());
    const failure = new Error('connection terminated');
    h.prisma.$transaction.mockRejectedValue(failure);

    await expect(
      h.service.upsertRule(ACTION_TYPE, { tier: AgentPolicyTier.PROPOSE }),
    ).rejects.toBe(failure);
  });

  it('rejects a caller with no User row and writes nothing', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());
    h.prisma.user.findUnique.mockResolvedValue(null);

    await expectRejectedWithoutWrite(
      h,
      h.service.upsertRule(ACTION_TYPE, { tier: AgentPolicyTier.PROPOSE }),
      ForbiddenException,
      { message: 'Active tenant membership is required.' },
    );
  });

  it('rejects a caller whose tenant membership is not active', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());
    h.prisma.tenantMember.findFirst.mockResolvedValue(null);

    await expectRejectedWithoutWrite(
      h,
      h.service.upsertRule(ACTION_TYPE, { tier: AgentPolicyTier.PROPOSE }),
      ForbiddenException,
      { message: 'Active tenant membership is required.' },
    );
  });

  it('validates the tier before checking tenant membership', async () => {
    await expectValidationBeforeMembership(
      { tier: AgentPolicyTier.PROPOSE },
      { tier: AgentPolicyTier.AUTO },
      { code: 'AGENT_POLICY_LOOSER_THAN_PLATFORM' },
    );
  });

  it('validates the conditions before checking tenant membership', async () => {
    await expectValidationBeforeMembership(
      {},
      { tier: AgentPolicyTier.AUTO, conditions: { amount_max: 500 } },
      { code: 'AGENT_POLICY_LOOSER_THAN_PLATFORM' },
    );
  });
});

describe('AgentPolicyService.evaluate', () => {
  it.each(['SALES', null])(
    'rejects %s callers unless skipAdminCheck is set',
    async (role) => {
      const h = buildHarness({ role });

      await expectRejection(
        h.service.evaluate({ action_type: ACTION_TYPE }),
        ForbiddenException,
        { message: 'Tenant admin access is required.' },
      );
      expect(h.tenantContext.getTenantId).not.toHaveBeenCalled();
      expect(h.prisma.agentPolicyRule.findFirst).not.toHaveBeenCalled();
    },
  );

  it('skips the admin gate for agent callers when skipAdminCheck is set', async () => {
    const h = buildHarness({ role: 'SALES' });
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await expect(
      h.service.evaluate(
        { action_type: ACTION_TYPE },
        { skipAdminCheck: true },
      ),
    ).resolves.toEqual({
      tier: AgentPolicyTier.AUTO,
      reasons: ['base_tier_auto'],
      rule_id: 'rule-row-1',
      rule_version: 1,
    });
  });

  it('trims the action type before resolving either rule', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await h.service.evaluate({ action_type: '  inventory.part_reserve  ' });

    expectLatestRuleLookup(h.prisma.agentPolicyRule.findFirst, {
      tenant_id: TENANT_ID,
      action_type: ACTION_TYPE,
    });
    expectLatestRuleLookup(h.systemPrisma.agentPolicyRule.findFirst, {
      tenant_id: null,
      action_type: ACTION_TYPE,
    });
  });

  it('evaluates against an empty context when none is sent', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await expect(
      h.service.evaluate({ action_type: ACTION_TYPE }),
    ).resolves.toMatchObject({
      tier: AgentPolicyTier.AUTO,
      reasons: ['base_tier_auto'],
    });
  });

  it('treats a null context as empty, as a JSON null body field can send', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await expect(
      h.service.evaluate({
        action_type: ACTION_TYPE,
        context: null,
      } as unknown as AgentPolicyEvaluateRequestDto),
    ).resolves.toMatchObject({
      tier: AgentPolicyTier.AUTO,
      reasons: ['base_tier_auto'],
    });
  });

  it('applies escalations from the request context', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await expect(
      h.service.evaluate({
        action_type: ACTION_TYPE,
        context: { amount_eur: 300 },
      }),
    ).resolves.toMatchObject({
      tier: AgentPolicyTier.PROPOSE,
      reasons: ['base_tier_auto', 'amount_above_threshold'],
    });
  });

  it('prefers the active tenant override and never reads the platform default', async () => {
    const h = buildHarness();
    h.prisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({
        id: 'tenant-row-2',
        tenant_id: TENANT_ID,
        tier: AgentPolicyTier.HUMAN_ONLY,
        version: 2,
      }),
    );

    await expect(
      h.service.evaluate({ action_type: ACTION_TYPE }),
    ).resolves.toEqual({
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['base_tier_human_only'],
      rule_id: 'tenant-row-2',
      rule_version: 2,
    });
    expect(h.systemPrisma.agentPolicyRule.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed on a disabled tenant override and reports that override', async () => {
    const h = buildHarness();
    h.prisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({
        id: 'tenant-row-2',
        tenant_id: TENANT_ID,
        enabled: false,
        version: 2,
      }),
    );

    await expect(
      h.service.evaluate({ action_type: ACTION_TYPE }),
    ).resolves.toEqual({
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['rule_disabled_fail_closed'],
      rule_id: 'tenant-row-2',
      rule_version: 2,
    });
  });

  it('fails closed when neither a tenant override nor a platform default exists', async () => {
    const h = buildHarness();

    await expect(
      h.service.evaluate({ action_type: 'made.up' }),
    ).resolves.toEqual({
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['unknown_action_fail_closed'],
      rule_id: null,
      rule_version: null,
    });
  });

  it('keeps the hard floor ahead of an AUTO rule', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({ action_type: 'invoice.finalize' }),
    );

    await expect(
      h.service.evaluate({ action_type: 'invoice.finalize' }),
    ).resolves.toEqual({
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['hard_floor_category'],
      rule_id: 'rule-row-1',
      rule_version: 1,
    });
  });
});

describe('AgentPolicyService.evaluateAction', () => {
  it.each(['SALES', 'ADMIN'])(
    'evaluates for %s callers without the admin gate',
    async (role) => {
      const h = buildHarness({ role });
      h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

      await expect(h.service.evaluateAction(ACTION_TYPE)).resolves.toEqual({
        tier: AgentPolicyTier.AUTO,
        reasons: ['base_tier_auto'],
        rule_id: 'rule-row-1',
        rule_version: 1,
      });
    },
  );

  it('passes a null context through unchanged, so an enabled rule throws (current behaviour)', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await expect(
      h.service.evaluateAction(ACTION_TYPE, null as never),
    ).rejects.toThrow(TypeError);
  });

  it('defaults the context to empty and applies escalations from a supplied context', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await expect(h.service.evaluateAction(ACTION_TYPE)).resolves.toMatchObject({
      tier: AgentPolicyTier.AUTO,
    });
    await expect(
      h.service.evaluateAction(ACTION_TYPE, { customer_facing: true }),
    ).resolves.toMatchObject({
      tier: AgentPolicyTier.PROPOSE,
      reasons: ['base_tier_auto', 'customer_facing_requires_propose'],
    });
  });

  it('prefers the active tenant override over the platform default', async () => {
    const h = buildHarness();
    h.prisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({ id: 'tenant-row-2', tenant_id: TENANT_ID, version: 2 }),
    );

    await expect(h.service.evaluateAction(ACTION_TYPE)).resolves.toMatchObject({
      rule_id: 'tenant-row-2',
      rule_version: 2,
    });
    expect(h.systemPrisma.agentPolicyRule.findFirst).not.toHaveBeenCalled();
  });

  it('looks the action type up exactly as given, without trimming (unlike evaluate)', async () => {
    const h = buildHarness();
    const padded = '  inventory.part_reserve  ';

    await expect(h.service.evaluateAction(padded)).resolves.toMatchObject({
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['unknown_action_fail_closed'],
    });
    expectLatestRuleLookup(h.prisma.agentPolicyRule.findFirst, {
      tenant_id: TENANT_ID,
      action_type: padded,
    });
    expectLatestRuleLookup(h.systemPrisma.agentPolicyRule.findFirst, {
      tenant_id: null,
      action_type: padded,
    });
  });
});

describe('AgentPolicyService tenant isolation', () => {
  it('lists rules for the tenant on the request context only', async () => {
    const h = buildHarness({ tenantId: OTHER_TENANT_ID });

    await h.service.listRules();

    expect(h.prisma.agentPolicyRule.findMany).toHaveBeenCalledWith({
      where: { tenant_id: OTHER_TENANT_ID },
      orderBy: [{ action_type: 'asc' }, { version: 'desc' }],
    });
    expect(h.systemPrisma.agentPolicyRule.findMany).toHaveBeenCalledWith({
      where: { tenant_id: null },
      orderBy: [{ action_type: 'asc' }, { version: 'desc' }],
    });
  });

  it('resolves overrides for the tenant on the request context only', async () => {
    const h = buildHarness({ tenantId: OTHER_TENANT_ID });
    h.prisma.agentPolicyRule.findFirst.mockResolvedValue(
      ruleRow({
        id: 'other-tenant-row',
        tenant_id: OTHER_TENANT_ID,
        version: 2,
      }),
    );

    await expect(h.service.evaluateAction(ACTION_TYPE)).resolves.toMatchObject({
      rule_id: 'other-tenant-row',
    });
    expectLatestRuleLookup(h.prisma.agentPolicyRule.findFirst, {
      tenant_id: OTHER_TENANT_ID,
      action_type: ACTION_TYPE,
    });
  });

  it('ignores a tenant_id sent in an upsert body and writes to the active tenant', async () => {
    const h = buildHarness();
    h.systemPrisma.agentPolicyRule.findFirst.mockResolvedValue(ruleRow());

    await h.service.upsertRule(ACTION_TYPE, {
      tier: AgentPolicyTier.PROPOSE,
      tenant_id: OTHER_TENANT_ID,
    } as UpsertAgentPolicyRuleDto);

    expectLatestRuleLookup(h.prisma.agentPolicyRule.findFirst, {
      tenant_id: TENANT_ID,
      action_type: ACTION_TYPE,
    });
    expectRuleWritten(h, { tenant_id: TENANT_ID });
  });
});
