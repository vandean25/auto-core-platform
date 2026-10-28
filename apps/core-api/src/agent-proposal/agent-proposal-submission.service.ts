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
import { AgentProposalSubmitPayloadNormalizer } from './agent-proposal-submit-payload-normalizer.service.js';

/** Extra fields only server-side callers (e.g. the workshop command) may attach. */
export type SubmitPendingActionOptions = {
  /**
   * Persists `AgentProposal.command_id` for the workshop command idempotency
   * key. The REST submit route never sets this.
   */
  command_id?: string;
  /** Extra keys merged into `preview_json` (e.g. `command_fingerprint`). */
  preview_json?: Record<string, unknown>;
};

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
    private readonly submitPayloadNormalizer: AgentProposalSubmitPayloadNormalizer,
  ) {}

  private async normalizeSubmitPayload(
    actionType: string,
    payload: unknown,
  ): Promise<unknown> {
    return this.submitPayloadNormalizer.normalize(actionType, payload);
  }

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
    command_id?: string;
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
        command_id: input.command_id ?? null,
      },
    });
    return toAgentProposalResponseDto(created);
  }

  async submitPendingAction(
    dto: SubmitPendingAgentActionDto,
    options?: SubmitPendingActionOptions,
  ): Promise<AgentProposalResponseDto> {
    const actionType = dto.action_type;
    const payload = await this.normalizeSubmitPayload(
      actionType,
      dto.payload_json,
    );
    const executor = this.pendingActionExecutors.resolve(actionType);
    const evaluation = await this.policyEvaluator.evaluate(
      actionType,
      payload,
      executor,
    );
    this.assertProposeTier(evaluation);

    const { intendedSiteId, simulation } = await this.simulatePendingAction(
      executor,
      payload,
    );
    const traceId = randomUUID();
    await this.agentActionLog.record({
      traceId,
      actorType: 'USER',
      onBehalfOfUserId: this.tenantContext.getAuthenticatedUser()?.userId,
      actionType,
      tier: AgentPolicyTier.PROPOSE,
      status: 'PROPOSED',
      inputSummary: { payload },
      resultSummary: { would_change: simulation.wouldChange },
    });

    return this.persistPendingAction({
      action_type: actionType,
      payload_json: payload,
      preview_json: buildPreviewJson({
        simulation,
        intendedSiteId,
        mcpIdempotency: mcpIdempotencyPreview(
          dto,
          options,
          actionType,
          payload,
        ),
        extra: options?.preview_json,
      }),
      tier: AgentPolicyTier.PROPOSE,
      trace_id: traceId,
      command_id: options?.command_id,
    });
  }

  private assertProposeTier(evaluation: { tier: AgentPolicyTier }): void {
    if (evaluation.tier !== AgentPolicyTier.PROPOSE) {
      throw new UnprocessableEntityException(
        'Only actions currently evaluated as PROPOSE can be submitted for approval',
      );
    }
  }

  private async simulatePendingAction(
    executor: ReturnType<PendingActionExecutorService['resolve']>,
    payload: unknown,
  ): Promise<{
    intendedSiteId: string | undefined;
    simulation: Awaited<
      ReturnType<DryRunService['executeInRollbackTransaction']>
    >;
  }> {
    const executionContext = await executor.buildExecutionContext?.(payload);
    const intendedSiteId = siteIdOf(executionContext);
    const simulation = await this.dryRun.executeInRollbackTransaction(() =>
      executor.execute(payload, executionContext),
    );
    if (
      intendedSiteId &&
      (await this.siteContext.getSiteId()) !== intendedSiteId
    ) {
      throw new UnprocessableEntityException(
        'The active site changed while the pending action was simulated',
      );
    }
    return { intendedSiteId, simulation };
  }
}

function siteIdOf(
  context: { site_id?: unknown } | undefined,
): string | undefined {
  return typeof context?.site_id === 'string' ? context.site_id : undefined;
}

function mcpIdempotencyPreview(
  dto: SubmitPendingAgentActionDto,
  options: SubmitPendingActionOptions | undefined,
  actionType: string,
  payload: unknown,
): Record<string, unknown> {
  if (!dto.command_id || options?.command_id) return {};
  return {
    mcp_command_idempotency: {
      command_id: dto.command_id,
      args_fingerprint: fingerprintMcpWriteArgs(actionType, payload),
    },
  };
}

function buildPreviewJson(input: {
  simulation: Awaited<
    ReturnType<DryRunService['executeInRollbackTransaction']>
  >;
  intendedSiteId: string | undefined;
  mcpIdempotency: Record<string, unknown>;
  extra: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  return {
    result: input.simulation.result,
    would_change: input.simulation.wouldChange,
    // Nothing is committed until the pending action is applied, so the whole preview is provisional.
    provisional: true,
    ...(input.intendedSiteId
      ? { execution_context: { site_id: input.intendedSiteId } }
      : {}),
    ...input.mcpIdempotency,
    ...(input.extra ?? {}),
  };
}
