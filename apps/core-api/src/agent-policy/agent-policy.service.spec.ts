import { AgentPolicyTier } from '@prisma/client';
import type { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { AgentPolicyService } from './agent-policy.service.js';

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
