import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgentPolicyTier, AuditLogAction, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import {
  AGENT_POLICY_AUDIT_SOURCE,
  AGENT_POLICY_ENTITY_TYPE,
  AGENT_POLICY_ERROR_CODES,
} from './agent-policy.constants.js';
import {
  evaluateAgentPolicy,
  parseAgentPolicyConditions,
} from './agent-policy.evaluator.js';
import { isTierAtLeastAsStrictAs } from './agent-policy-tier.util.js';
import type {
  AgentPolicyEvaluateContext,
  AgentPolicyEvaluationResult,
  ResolvedAgentPolicyRule,
} from './agent-policy.types.js';
import type {
  AgentPolicyEvaluateRequestDto,
  AgentPolicyRuleListResponseDto,
  AgentPolicyRuleResponseDto,
  UpsertAgentPolicyRuleDto,
} from './dto/agent-policy.dto.js';

type AgentPolicyRuleRow = {
  id: string;
  tenant_id: string | null;
  action_type: string;
  tier: AgentPolicyTier;
  conditions_json: Prisma.JsonValue;
  enabled: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class AgentPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async listRules(): Promise<AgentPolicyRuleListResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const effective = await this.loadEffectiveRules(tenantId);
    return {
      data: effective.map((rule) => this.toResponseDto(rule)),
    };
  }

  async upsertRule(
    actionType: string,
    body: UpsertAgentPolicyRuleDto,
  ): Promise<AgentPolicyRuleResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const normalizedAction = actionType.trim();
    if (!normalizedAction) {
      throw new BadRequestException('action_type is required');
    }

    const platformRule = await this.findLatestPlatformRule(normalizedAction);
    if (!platformRule) {
      throw new BadRequestException({
        code: AGENT_POLICY_ERROR_CODES.UNKNOWN_ACTION_TYPE,
        message: `Unknown action type: ${normalizedAction}`,
      });
    }

    if (!isTierAtLeastAsStrictAs(body.tier, platformRule.tier)) {
      throw new UnprocessableEntityException({
        code: AGENT_POLICY_ERROR_CODES.LOOSER_THAN_PLATFORM,
        message:
          'Tenant policy tier must be at least as strict as the platform default.',
      });
    }

    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const latestTenantRule = await this.findLatestTenantRule(
      tenantId,
      normalizedAction,
    );
    const nextVersion = (latestTenantRule?.version ?? 0) + 1;
    const conditions = body.conditions ?? platformRule.conditions;

    const before = latestTenantRule
      ? this.serializeAuditSnapshot(latestTenantRule)
      : this.serializeAuditSnapshot(platformRule);

    const created = await this.prisma.agentPolicyRule.create({
      data: {
        tenant_id: tenantId,
        action_type: normalizedAction,
        tier: body.tier,
        conditions_json: conditions,
        enabled: body.enabled ?? true,
        version: nextVersion,
        created_by: currentUser.id,
      },
    });

    const resolved = this.toResolvedRule(created, 'tenant');
    const after = this.serializeAuditSnapshot(resolved);

    await this.auditService.recordTenantMutation({
      entityType: AGENT_POLICY_ENTITY_TYPE,
      entityId: created.id,
      action: AuditLogAction.UPDATE,
      actorUserId: currentUser.id,
      source: AGENT_POLICY_AUDIT_SOURCE,
      before,
      after,
      diff: {
        tier: { before: before.tier, after: after.tier },
        version: { before: before.version, after: after.version },
      },
    });

    return this.toResponseDto(resolved);
  }

  async evaluate(
    body: AgentPolicyEvaluateRequestDto,
  ): Promise<AgentPolicyEvaluationResult> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const actionType = body.action_type.trim();
    const context: AgentPolicyEvaluateContext = body.context ?? {};
    const rule = await this.resolveEffectiveRule(tenantId, actionType);
    return evaluateAgentPolicy(actionType, context, rule);
  }

  private async loadEffectiveRules(
    tenantId: string,
  ): Promise<ResolvedAgentPolicyRule[]> {
    const platformRules = await this.listLatestPlatformRules();
    const tenantRules = await this.listLatestTenantRules(tenantId);
    const tenantByAction = new Map(
      tenantRules.map((rule) => [rule.action_type, rule]),
    );

    const actionTypes = new Set([
      ...platformRules.map((rule) => rule.action_type),
      ...tenantRules.map((rule) => rule.action_type),
    ]);

    return [...actionTypes]
      .sort()
      .map((actionType) => {
        const tenantRule = tenantByAction.get(actionType);
        if (tenantRule) {
          return this.toResolvedRule(tenantRule, 'tenant');
        }
        const platformRule = platformRules.find(
          (rule) => rule.action_type === actionType,
        );
        return platformRule
          ? this.toResolvedRule(platformRule, 'platform')
          : null;
      })
      .filter((rule): rule is ResolvedAgentPolicyRule => rule !== null);
  }

  private async resolveEffectiveRule(
    tenantId: string,
    actionType: string,
  ): Promise<ResolvedAgentPolicyRule | null> {
    const tenantRule = await this.findLatestTenantRule(tenantId, actionType);
    if (tenantRule) {
      return this.toResolvedRule(tenantRule, 'tenant');
    }

    return this.findLatestPlatformRule(actionType);
  }

  private async listLatestPlatformRules(): Promise<AgentPolicyRuleRow[]> {
    const rows = await this.systemPrisma.agentPolicyRule.findMany({
      where: { tenant_id: null, enabled: true },
      orderBy: [{ action_type: 'asc' }, { version: 'desc' }],
    });

    const latestByAction = new Map<string, AgentPolicyRuleRow>();
    for (const row of rows) {
      if (!latestByAction.has(row.action_type)) {
        latestByAction.set(row.action_type, row);
      }
    }
    return [...latestByAction.values()].sort((a, b) =>
      a.action_type.localeCompare(b.action_type),
    );
  }

  private async listLatestTenantRules(
    tenantId: string,
  ): Promise<AgentPolicyRuleRow[]> {
    const rows = await this.prisma.agentPolicyRule.findMany({
      where: { tenant_id: tenantId, enabled: true },
      orderBy: [{ action_type: 'asc' }, { version: 'desc' }],
    });

    const latestByAction = new Map<string, AgentPolicyRuleRow>();
    for (const row of rows) {
      if (!latestByAction.has(row.action_type)) {
        latestByAction.set(row.action_type, row);
      }
    }
    return [...latestByAction.values()];
  }

  private async findLatestPlatformRule(
    actionType: string,
  ): Promise<ResolvedAgentPolicyRule | null> {
    const row = await this.systemPrisma.agentPolicyRule.findFirst({
      where: { tenant_id: null, action_type: actionType, enabled: true },
      orderBy: { version: 'desc' },
    });
    return row ? this.toResolvedRule(row, 'platform') : null;
  }

  private async findLatestTenantRule(
    tenantId: string,
    actionType: string,
  ): Promise<AgentPolicyRuleRow | null> {
    return this.prisma.agentPolicyRule.findFirst({
      where: { tenant_id: tenantId, action_type: actionType, enabled: true },
      orderBy: { version: 'desc' },
    });
  }

  private toResolvedRule(
    row: AgentPolicyRuleRow,
    source: 'platform' | 'tenant',
  ): ResolvedAgentPolicyRule {
    return {
      id: row.id,
      version: row.version,
      action_type: row.action_type,
      tier: row.tier,
      conditions: parseAgentPolicyConditions(row.conditions_json),
      enabled: row.enabled,
      source,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private serializeAuditSnapshot(rule: {
    action_type: string;
    tier: AgentPolicyTier;
    conditions?: ReturnType<typeof parseAgentPolicyConditions>;
    conditions_json?: Prisma.JsonValue;
    enabled: boolean;
    version: number;
    source?: 'platform' | 'tenant';
  }) {
    const conditions =
      rule.conditions ?? parseAgentPolicyConditions(rule.conditions_json ?? {});
    return {
      action_type: rule.action_type,
      tier: rule.tier,
      conditions,
      enabled: rule.enabled,
      version: rule.version,
      source: rule.source ?? 'tenant',
    };
  }

  private toResponseDto(
    rule: ResolvedAgentPolicyRule,
  ): AgentPolicyRuleResponseDto {
    return {
      id: rule.id,
      action_type: rule.action_type,
      tier: rule.tier,
      conditions: rule.conditions,
      enabled: rule.enabled,
      version: rule.version,
      source: rule.source,
      created_at: rule.created_at.toISOString(),
      updated_at: rule.updated_at.toISOString(),
    };
  }
}
