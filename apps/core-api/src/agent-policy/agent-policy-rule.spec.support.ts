import { AgentPolicyTier } from '@prisma/client';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import type { AgentPolicyRuleDeps } from './agent-policy-rule.store.js';

export const TENANT_ID = 'tenant-1';
export const ACTION_TYPE = 'inventory.part_reserve';

/** A stored rule row. Platform rows have `tenant_id: null`; pass overrides for tenant rows. */
export function ruleRow(overrides: Record<string, unknown> = {}) {
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

/**
 * Prisma, system-client and audit doubles for the rule store. Queries return no
 * rows until a test stubs them; `$transaction` is stubbed by the tests that write.
 */
export function buildRuleDeps() {
  const prisma = {
    agentPolicyRule: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  };
  const systemPrisma = {
    agentPolicyRule: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const auditService = {
    recordTenantMutation: jest.fn().mockResolvedValue(undefined),
  };
  const deps = {
    prisma: prisma as unknown as PrismaService,
    systemPrisma: systemPrisma as unknown as SystemPrismaService,
    auditService: auditService as unknown as AuditService,
  } satisfies AgentPolicyRuleDeps;
  return { deps, prisma, systemPrisma, auditService };
}
