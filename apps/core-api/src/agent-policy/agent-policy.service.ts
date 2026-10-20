import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import { evaluateAgentPolicy } from './agent-policy.evaluator.js';
import { loadEffectiveRules } from './agent-policy-rule.load-effective.js';
import {
  requirePlatformRule,
  resolveEffectiveRule,
} from './agent-policy-rule.resolve-effective.js';
import {
  toAgentPolicyRuleResponseDto,
  toAuditSnapshot,
} from './agent-policy-response.util.js';
import {
  createTenantRuleVersion,
  findLatestTenantRow,
  type AgentPolicyRuleDeps,
} from './agent-policy-rule.store.js';
import { toResolvedRule } from './agent-policy-rule.util.js';
import {
  assertTierNotLooserThanPlatform,
  normalizeActionType,
  resolveTenantConditions,
} from './agent-policy-upsert.util.js';
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

@Injectable()
export class AgentPolicyService {
  private readonly deps: AgentPolicyRuleDeps;
  private readonly tenantContext: TenantContextService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    prisma: PrismaService,
    systemPrisma: SystemPrismaService,
    tenantContext: TenantContextService,
    auditService: AuditService,
  ) {
    this.deps = { prisma, systemPrisma, auditService };
    this.tenantContext = tenantContext;
  }

  async listRules(): Promise<AgentPolicyRuleListResponseDto> {
    const tenantId = await this.requireAdminTenantId();
    const effective = await this.loadEffectiveRulesForList(tenantId);
    return {
      data: effective.map((rule) => toAgentPolicyRuleResponseDto(rule)),
    };
  }

  async upsertRule(
    actionType: string,
    body: UpsertAgentPolicyRuleDto,
  ): Promise<AgentPolicyRuleResponseDto> {
    const tenantId = await this.requireAdminTenantId();
    const normalizedAction = normalizeActionType(actionType);
    const platformRule = await requirePlatformRule(this.deps, normalizedAction);
    assertTierNotLooserThanPlatform(body.tier, platformRule.tier);
    const conditions = resolveTenantConditions(
      platformRule.conditions,
      body.conditions,
    );
    const currentUser = await requireActiveCurrentUser(
      this.deps.prisma,
      this.tenantContext,
      tenantId,
    );

    const latestTenantRow = await findLatestTenantRow(
      this.deps,
      tenantId,
      normalizedAction,
    );
    const before = latestTenantRow
      ? toAuditSnapshot(toResolvedRule(latestTenantRow, 'tenant'))
      : toAuditSnapshot(platformRule);

    const created = await createTenantRuleVersion(this.deps, {
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
    const tenantId = options?.skipAdminCheck
      ? await this.tenantContext.getTenantId()
      : await this.requireAdminTenantId();
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
    return resolveEffectiveRule(this.deps, tenantId, actionType);
  }

  private async evaluateFor(
    tenantId: string,
    actionType: string,
    context: AgentPolicyEvaluateContext,
  ): Promise<AgentPolicyEvaluationResult> {
    const rule = await resolveEffectiveRule(this.deps, tenantId, actionType);
    return evaluateAgentPolicy(actionType, context, rule);
  }

  private async loadEffectiveRulesForList(
    tenantId: string,
  ): Promise<ResolvedAgentPolicyRule[]> {
    return loadEffectiveRules(this.deps, tenantId);
  }

  /** Admin gate for the rule-management endpoints. Returns the active tenant id. */
  private async requireAdminTenantId(): Promise<string> {
    assertTenantAdmin(this.tenantContext);
    return this.tenantContext.getTenantId();
  }
}
