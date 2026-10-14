import type { AgentPolicyTier, Prisma, PrismaClient } from '@prisma/client';
import type { AuditService } from '../audit/audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import {
  buildAgentPolicyUpdateAudit,
  toAuditSnapshot,
  type AgentPolicyAuditSnapshot,
} from './agent-policy-response.util.js';
import {
  toResolvedRule,
  type AgentPolicyRuleRow,
} from './agent-policy-rule.util.js';
import { toUpsertPersistenceError } from './agent-policy-upsert.util.js';
import type { AgentPolicyConditions } from './agent-policy.types.js';

/** The clients the rule queries and the version write run against. */
export type AgentPolicyRuleDeps = {
  prisma: PrismaService;
  systemPrisma: SystemPrismaService;
  auditService: AuditService;
};

/** The rule-row queries shared by the tenant and platform clients. */
type RuleDelegate = Pick<
  PrismaClient['agentPolicyRule'],
  'findFirst' | 'findMany'
>;

export type NewTenantRuleVersion = {
  tenantId: string;
  actionType: string;
  tier: AgentPolicyTier;
  conditions: AgentPolicyConditions;
  enabled: boolean;
  version: number;
  actorUserId: string;
  before: AgentPolicyAuditSnapshot;
};

/** Action type ascending, then newest version first within each action type. */
const RULE_LIST_ORDER: Prisma.AgentPolicyRuleOrderByWithRelationInput[] = [
  { action_type: 'asc' },
  { version: 'desc' },
];

export function findTenantRuleRows(
  deps: AgentPolicyRuleDeps,
  tenantId: string,
): Promise<AgentPolicyRuleRow[]> {
  return findRuleRows(deps.prisma.agentPolicyRule, { tenant_id: tenantId });
}

export function findPlatformRuleRows(
  deps: AgentPolicyRuleDeps,
): Promise<AgentPolicyRuleRow[]> {
  return findRuleRows(deps.systemPrisma.agentPolicyRule, { tenant_id: null });
}

export function findLatestTenantRow(
  deps: AgentPolicyRuleDeps,
  tenantId: string,
  actionType: string,
): Promise<AgentPolicyRuleRow | null> {
  return findLatestRow(deps.prisma.agentPolicyRule, {
    tenant_id: tenantId,
    action_type: actionType,
  });
}

export function findLatestPlatformRow(
  deps: AgentPolicyRuleDeps,
  actionType: string,
): Promise<AgentPolicyRuleRow | null> {
  return findLatestRow(deps.systemPrisma.agentPolicyRule, {
    tenant_id: null,
    action_type: actionType,
  });
}

/**
 * Writes the next tenant version and its audit entry in one transaction.
 * Version races and the DB tier guard surface as API errors.
 */
export async function createTenantRuleVersion(
  deps: AgentPolicyRuleDeps,
  input: NewTenantRuleVersion,
): Promise<AgentPolicyRuleRow> {
  try {
    return await deps.prisma.$transaction(async (tx) => {
      const row = await tx.agentPolicyRule.create({
        data: {
          tenant_id: input.tenantId,
          action_type: input.actionType,
          tier: input.tier,
          conditions_json: input.conditions,
          enabled: input.enabled,
          version: input.version,
          created_by: input.actorUserId,
        },
      });

      const after = toAuditSnapshot(toResolvedRule(row, 'tenant'));
      await deps.auditService.recordTenantMutation(
        buildAgentPolicyUpdateAudit({
          entityId: row.id,
          actorUserId: input.actorUserId,
          before: input.before,
          after,
        }),
        tx,
      );

      return row;
    });
  } catch (error) {
    throw toUpsertPersistenceError(error);
  }
}

function findRuleRows(
  delegate: RuleDelegate,
  where: Prisma.AgentPolicyRuleWhereInput,
): Promise<AgentPolicyRuleRow[]> {
  return delegate.findMany({ where, orderBy: RULE_LIST_ORDER });
}

function findLatestRow(
  delegate: RuleDelegate,
  where: Prisma.AgentPolicyRuleWhereInput,
): Promise<AgentPolicyRuleRow | null> {
  return delegate.findFirst({ where, orderBy: { version: 'desc' } });
}
