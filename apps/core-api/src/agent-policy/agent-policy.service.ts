import { BadRequestException, Injectable } from '@nestjs/common';
import type { AgentPolicyTier } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import { AGENT_POLICY_ERROR_CODES } from './agent-policy.constants.js';
import { evaluateAgentPolicy } from './agent-policy.evaluator.js';
import type {
  AgentPolicyConditions,
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
import type { AgentPolicyRuleRow } from './agent-policy-rule.util.js';
import {
  mergeEffectiveRules,
  toResolvedRule,
} from './agent-policy-rule.util.js';
import type { AgentPolicyAuditSnapshot } from './agent-policy-response.util.js';
import {
  buildAgentPolicyUpdateAudit,
  toAgentPolicyRuleResponseDto,
  toAuditSnapshot,
} from './agent-policy-response.util.js';
import {
  assertTierNotLooserThanPlatform,
  normalizeActionType,
  resolveTenantConditions,
  toUpsertPersistenceError,
} from './agent-policy-upsert.util.js';

type NewTenantRuleVersion = {
  tenantId: string;
  actionType: string;
  tier: AgentPolicyTier;
  conditions: AgentPolicyConditions;
  enabled: boolean;
  version: number;
  actorUserId: string;
  before: AgentPolicyAuditSnapshot;
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
      data: effective.map((rule) => toAgentPolicyRuleResponseDto(rule)),
    };
  }

  async upsertRule(
    actionType: string,
    body: UpsertAgentPolicyRuleDto,
  ): Promise<AgentPolicyRuleResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const normalizedAction = normalizeActionType(actionType);
    const platformRule = await this.requirePlatformRule(normalizedAction);
    assertTierNotLooserThanPlatform(body.tier, platformRule.tier);
    const conditions = resolveTenantConditions(
      platformRule.conditions,
      body.conditions,
    );
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const latestTenantRow = await this.findLatestTenantRow(
      tenantId,
      normalizedAction,
    );
    const before = latestTenantRow
      ? toAuditSnapshot(toResolvedRule(latestTenantRow, 'tenant'))
      : toAuditSnapshot(platformRule);

    const created = await this.createTenantRuleVersion({
      tenantId,
      actionType: normalizedAction,
      tier: body.tier,
      conditions,
      enabled: body.enabled ?? true,
      version: (latestTenantRow?.version ?? 0) + 1,
      actorUserId: currentUser.id,
      before,
    });
    return toAgentPolicyRuleResponseDto(toResolvedRule(created, 'tenant'));
  }

  async evaluate(
    body: AgentPolicyEvaluateRequestDto,
    options?: { skipAdminCheck?: boolean },
  ): Promise<AgentPolicyEvaluationResult> {
    if (!options?.skipAdminCheck) {
      assertTenantAdmin(this.tenantContext);
    }
    const tenantId = await this.tenantContext.getTenantId();
    return this.evaluateFor(
      tenantId,
      body.action_type.trim(),
      body.context ?? {},
    );
  }

  /**
   * Evaluates an action for the active tenant without the ADMIN assertion so
   * agent-facing callers (e.g. the MCP write pipeline) can resolve the
   * effective tier on behalf of the token's user and tenant.
   */
  async evaluateAction(
    actionType: string,
    context: AgentPolicyEvaluateContext = {},
  ): Promise<AgentPolicyEvaluationResult> {
    const tenantId = await this.tenantContext.getTenantId();
    return this.evaluateFor(tenantId, actionType, context);
  }

  /**
   * Configured rule for an action in the active tenant: the tenant override when
   * one exists, else the platform default, else null. Unlike evaluateAction this
   * keeps the configured tier and enabled flag, which evaluation collapses to
   * HUMAN_ONLY when a rule is disabled. Enforcement still goes through evaluateAction.
   */
  async getEffectiveRule(
    actionType: string,
  ): Promise<ResolvedAgentPolicyRule | null> {
    const tenantId = await this.tenantContext.getTenantId();
    return this.resolveEffectiveRule(tenantId, actionType);
  }

  private async evaluateFor(
    tenantId: string,
    actionType: string,
    context: AgentPolicyEvaluateContext,
  ): Promise<AgentPolicyEvaluationResult> {
    const rule = await this.resolveEffectiveRule(tenantId, actionType);
    return evaluateAgentPolicy(actionType, context, rule);
  }

  private async loadEffectiveRules(
    tenantId: string,
  ): Promise<ResolvedAgentPolicyRule[]> {
    const platformRows = await this.systemPrisma.agentPolicyRule.findMany({
      where: { tenant_id: null },
      orderBy: [{ action_type: 'asc' }, { version: 'desc' }],
    });
    const tenantRows = await this.prisma.agentPolicyRule.findMany({
      where: { tenant_id: tenantId },
      orderBy: [{ action_type: 'asc' }, { version: 'desc' }],
    });
    return mergeEffectiveRules(platformRows, tenantRows);
  }

  private async resolveEffectiveRule(
    tenantId: string,
    actionType: string,
  ): Promise<ResolvedAgentPolicyRule | null> {
    const tenantRow = await this.findLatestTenantRow(tenantId, actionType);
    if (tenantRow) {
      return toResolvedRule(tenantRow, 'tenant');
    }

    const platformRow = await this.findLatestPlatformRow(actionType);
    return platformRow ? toResolvedRule(platformRow, 'platform') : null;
  }

  private async requirePlatformRule(
    actionType: string,
  ): Promise<ResolvedAgentPolicyRule> {
    const row = await this.findLatestPlatformRow(actionType);
    if (!row) {
      throw new BadRequestException({
        code: AGENT_POLICY_ERROR_CODES.UNKNOWN_ACTION_TYPE,
        message: `Unknown action type: ${actionType}`,
      });
    }
    return toResolvedRule(row, 'platform');
  }

  /**
   * Writes the next tenant version and its audit entry in one transaction.
   * Version races and the DB tier guard surface as API errors.
   */
  private async createTenantRuleVersion(
    input: NewTenantRuleVersion,
  ): Promise<AgentPolicyRuleRow> {
    try {
      return await this.prisma.$transaction(async (tx) => {
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
        await this.auditService.recordTenantMutation(
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

  private async findLatestTenantRow(
    tenantId: string,
    actionType: string,
  ): Promise<AgentPolicyRuleRow | null> {
    return this.prisma.agentPolicyRule.findFirst({
      where: { tenant_id: tenantId, action_type: actionType },
      orderBy: { version: 'desc' },
    });
  }

  private async findLatestPlatformRow(
    actionType: string,
  ): Promise<AgentPolicyRuleRow | null> {
    return this.systemPrisma.agentPolicyRule.findFirst({
      where: { tenant_id: null, action_type: actionType },
      orderBy: { version: 'desc' },
    });
  }
}
