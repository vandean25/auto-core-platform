import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { assertSupervisorAccess } from './agent-proposal.authorization.js';
import { AgentProposalPolicyEvaluator } from './agent-proposal-policy-evaluator.service.js';
import { toAgentProposalResponseDto } from './agent-proposal-response.mapper.js';
import type {
  AgentProposalResponseDto,
  CreateAgentProposalDto,
  SubmitPendingAgentActionDto,
} from './dto/agent-proposal.dto.js';
import { fingerprintMcpWriteArgs } from '../mcp/mcp-write-command-idempotency.util.js';

/** Creates pending proposals: direct creation, persisted pending actions, and simulated submissions. */
@Injectable()
export class AgentProposalSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly agentActionLog: AgentActionLogService,
    private readonly siteContext: SiteContextService,
    private readonly dryRun: DryRunService,
    private readonly pendingActionExecutors: PendingActionExecutorService,
    private readonly policyEvaluator: AgentProposalPolicyEvaluator,
  ) {}

  async createProposal(
    dto: CreateAgentProposalDto,
  ): Promise<AgentProposalResponseDto> {
    assertSupervisorAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const traceId = dto.trace_id ?? randomUUID();

    const created = await this.prisma.agentProposal.create({
      data: {
        tenant_id: tenantId,
        trace_id: traceId,
        action_type: dto.action_type,
        payload_json: dto.payload_json as Prisma.InputJsonValue,
        preview_json: dto.preview_json
          ? (dto.preview_json as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        tier: dto.tier ?? AgentPolicyTier.PROPOSE,
        status: AgentProposalStatus.PENDING,
      },
    });

    return toAgentProposalResponseDto(created);
  }

  async persistPendingAction(input: {
    action_type: string;
    payload_json: unknown;
    preview_json: unknown;
    tier: AgentPolicyTier;
    trace_id: string;
    created_by_agent?: string;
  }): Promise<AgentProposalResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const created = await this.prisma.agentProposal.create({
      data: {
        tenant_id: tenantId,
        trace_id: input.trace_id,
        action_type: input.action_type,
        payload_json: input.payload_json as Prisma.InputJsonValue,
        preview_json: input.preview_json as Prisma.InputJsonValue,
        tier: input.tier,
        status: AgentProposalStatus.PENDING,
        created_by_agent: input.created_by_agent ?? null,
      },
    });
    return toAgentProposalResponseDto(created);
  }

  async submitPendingAction(
    dto: SubmitPendingAgentActionDto,
  ): Promise<AgentProposalResponseDto> {
    const actionType = dto.action_type;
    const executor = this.pendingActionExecutors.resolve(actionType);
    const evaluation = await this.policyEvaluator.evaluate(
      actionType,
      dto.payload_json,
      executor,
    );
    if (evaluation.tier !== AgentPolicyTier.PROPOSE) {
      throw new UnprocessableEntityException(
        'Only actions currently evaluated as PROPOSE can be submitted for approval',
      );
    }

    const executionContext = await executor.buildExecutionContext?.(
      dto.payload_json,
    );
    const intendedSiteId =
      typeof executionContext?.site_id === 'string'
        ? executionContext.site_id
        : undefined;
    const simulation = await this.dryRun.executeInRollbackTransaction(() =>
      executor.execute(dto.payload_json, executionContext),
    );
    if (
      intendedSiteId &&
      (await this.siteContext.getSiteId()) !== intendedSiteId
    ) {
      throw new UnprocessableEntityException(
        'The active site changed while the pending action was simulated',
      );
    }
    const traceId = randomUUID();
    await this.agentActionLog.record({
      traceId,
      actorType: 'USER',
      onBehalfOfUserId: this.tenantContext.getAuthenticatedUser()?.userId,
      actionType,
      tier: AgentPolicyTier.PROPOSE,
      status: 'PROPOSED',
      inputSummary: { payload: dto.payload_json },
      resultSummary: { would_change: simulation.wouldChange },
    });
    const mcpIdempotency = dto.command_id
      ? {
          mcp_command_idempotency: {
            command_id: dto.command_id,
            args_fingerprint: fingerprintMcpWriteArgs(
              actionType,
              dto.payload_json,
            ),
          },
        }
      : {};

    return this.persistPendingAction({
      action_type: actionType,
      payload_json: dto.payload_json,
      preview_json: {
        result: simulation.result,
        would_change: simulation.wouldChange,
        // Nothing is committed until the pending action is applied, so the whole preview is provisional.
        provisional: true,
        ...(intendedSiteId
          ? { execution_context: { site_id: intendedSiteId } }
          : {}),
        ...mcpIdempotency,
      },
      tier: AgentPolicyTier.PROPOSE,
      trace_id: traceId,
    });
  }
}
