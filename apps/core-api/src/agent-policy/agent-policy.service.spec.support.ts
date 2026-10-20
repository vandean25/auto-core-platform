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
import { ruleRow } from './agent-policy-rule.spec.support.js';
import type {
  AgentPolicyEvaluateRequestDto,
  UpsertAgentPolicyRuleDto,
} from './dto/agent-policy.dto.js';

export { ruleRow };

export const TENANT_ID = 'tenant-1';
export const ACTION_TYPE = 'inventory.part_reserve';
export const FIREBASE_UID = 'firebase-uid-1';

export function createService() {
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

export function runAsRole(
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

export const OTHER_TENANT_ID = 'tenant-2';
export const USER_ROW_ID = 'user-row-1';
export const NEW_ROW_ID = 'tenant-row-new';
export const ROW_TIMESTAMP = '2026-10-01T00:00:00.000Z';
export const NOW = new Date('2026-10-02T00:00:00.000Z');

/**
 * Service wired to jest doubles for Prisma, the system client, audit and the
 * tenant context, so each test states the exact rows and identity it needs.
 * Transactions run the callback against `tx`, whose create echoes the data back
 * as a stored row.
 */
export function buildHarness({
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

export type Harness = ReturnType<typeof buildHarness>;

type HttpExceptionType = new (...args: never[]) => HttpException;

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to reject');
}

export async function expectRejection(
  promise: Promise<unknown>,
  type: HttpExceptionType,
  response: object,
): Promise<void> {
  const error = await captureRejection(promise);
  expect(error).toBeInstanceOf(type);
  expect((error as HttpException).getResponse()).toMatchObject(response);
}

/** A rejection that must happen before any transaction opens. */
export async function expectRejectedWithoutWrite(
  h: Harness,
  promise: Promise<unknown>,
  type: HttpExceptionType,
  response: object,
): Promise<void> {
  await expectRejection(promise, type, response);
  expect(h.prisma.$transaction).not.toHaveBeenCalled();
}

export function expectRuleWritten(h: Harness, data: Record<string, unknown>): void {
  expect(h.tx.agentPolicyRule.create).toHaveBeenCalledWith({
    data: expect.objectContaining(data),
  });
}

/** Body validation rejects before the membership lookup runs. */
export async function expectValidationBeforeMembership(
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

export function expectLatestRuleLookup(
  query: jest.Mock,
  where: Record<string, unknown>,
): void {
  expect(query).toHaveBeenCalledWith({ where, orderBy: { version: 'desc' } });
}

/** A tenant override at `tier` is accepted and written as a tenant-source rule. */
export async function expectOverrideAccepted(
  h: Harness,
  tier: AgentPolicyTier,
): Promise<void> {
  await expect(h.service.upsertRule(ACTION_TYPE, { tier })).resolves.toMatchObject(
    { tier, source: 'tenant' },
  );
  expectRuleWritten(h, { tier });
}

/** The DTO a row with `ruleRow()` defaults maps to, with per-test overrides. */
export function expectedDto(overrides: Record<string, unknown> = {}) {
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
export function snapshot(fields: Record<string, unknown>) {
  return { action_type: ACTION_TYPE, enabled: true, ...fields };
}

/** The UPDATE audit entry the upsert writes for a before/after pair. */
export function auditEntry(
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

export const CUSTOMER_CODE_DEFAULT_MATCHERS = [
  expect.objectContaining({
    id: 'code-default:customer.create',
    action_type: 'customer.create',
    tier: AgentPolicyTier.PROPOSE,
    enabled: false,
    source: 'platform',
  }),
  expect.objectContaining({
    id: 'code-default:customer.update',
    action_type: 'customer.update',
    tier: AgentPolicyTier.PROPOSE,
    enabled: false,
    source: 'platform',
  }),
];

export function expectListRulesIncludesCustomerDefaults(
  data: { action_type: string }[],
): void {
  expect(data).toEqual(expect.arrayContaining(CUSTOMER_CODE_DEFAULT_MATCHERS));
}

