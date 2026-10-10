import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { AgentActionRecordInput } from '../agent-action-log/agent-action-log.types.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import {
  MCP_AGENT_FACING_CODES,
  type McpWriteToolName,
} from './mcp.constants.js';
import { effectiveMcpWriteTier } from './mcp-write-tier.util.js';

export type McpWriteToolContext = {
  agentId: string;
  onBehalfOfUserId: string;
};

export type McpWriteExecution = {
  toolName: McpWriteToolName;
  policyActionType: string;
  buildPolicyContext: (
    input: unknown,
  ) => AgentPolicyEvaluateContext | Promise<AgentPolicyEvaluateContext>;
  buildExecutionContext?: () => Promise<Record<string, unknown>>;
  execute: (
    input: unknown,
    executionContext?: Record<string, unknown>,
  ) => Promise<unknown>;
  buildResultSummary: (result: unknown) => unknown;
  buildLogMetadata?: (
    result: unknown,
  ) => Pick<AgentActionRecordInput, 'entityType' | 'entityId' | 'reversible'>;
};

export type McpWriteToolResult = {
  tool: McpWriteToolName;
  tier: AgentPolicyTier;
  status: 'executed' | 'needs_approval';
  would_change: WouldChangeItem[];
  result?: unknown;
  proposal?: unknown;
  pending_action_id?: string;
  trace_id?: string;
};

const logActionType = (toolName: McpWriteToolName): string => `mcp.${toolName}`;

@Injectable()
export class McpWritePipelineService {
  constructor(
    private readonly agentPolicy: AgentPolicyService,
    private readonly dryRun: DryRunService,
    private readonly agentActionLog: AgentActionLogService,
    private readonly agentProposals: AgentProposalService,
  ) {}

  async run(
    execution: McpWriteExecution,
    input: unknown,
    context: McpWriteToolContext,
  ): Promise<McpWriteToolResult> {
    const actionType = logActionType(execution.toolName);
    const inputSummary = { tool: execution.toolName, args: input };

    let tier: AgentPolicyTier = AgentPolicyTier.PROPOSE;
    let wouldChange: WouldChangeItem[];
    let preview: unknown;
    let executionContext: Record<string, unknown> | undefined;
    let reasons: string[] = [];

    const recordFailure = async (error: unknown) => {
      await this.agentActionLog.record({
        actorType: 'AGENT',
        agentId: context.agentId,
        onBehalfOfUserId: context.onBehalfOfUserId,
        actionType,
        tier,
        status: 'FAILED',
        inputSummary,
        resultSummary: {
          reasons,
          error: error instanceof Error ? error.message : 'Write tool failed',
        },
      });
    };

    try {
      const policyContext = await execution.buildPolicyContext(input);
      const evaluation = await this.agentPolicy.evaluateAction(
        execution.policyActionType,
        policyContext,
      );
      tier = effectiveMcpWriteTier(execution.toolName, evaluation.tier);
      reasons = evaluation.reasons;
    } catch (error) {
      await recordFailure(error);
      throw error;
    }

    if (tier === AgentPolicyTier.HUMAN_ONLY) {
      await this.agentActionLog.record({
        actorType: 'AGENT',
        agentId: context.agentId,
        onBehalfOfUserId: context.onBehalfOfUserId,
        actionType,
        tier,
        status: MCP_AGENT_FACING_CODES.refusedLogStatus,
        inputSummary,
        resultSummary: { reasons },
      });
      throw new ForbiddenException({
        code: MCP_AGENT_FACING_CODES.notPermitted,
        message: `${MCP_AGENT_FACING_CODES.notPermitted}: Action ${execution.policyActionType} requires human approval and was refused.`,
      });
    }

    try {
      executionContext =
        tier === AgentPolicyTier.PROPOSE
          ? await execution.buildExecutionContext?.()
          : undefined;
      const previewResult = await this.dryRun.executeInRollbackTransaction(() =>
        execution.execute(input, executionContext),
      );
      preview = previewResult.result;
      wouldChange = previewResult.wouldChange;
      if (executionContext?.site_id !== undefined) {
        const appliedContext = await execution.buildExecutionContext?.();
        if (appliedContext?.site_id !== executionContext.site_id) {
          throw new ConflictException(
            'The active site changed while the pending action was simulated',
          );
        }
      }
    } catch (error) {
      await recordFailure(error);
      throw error;
    }

    if (tier === AgentPolicyTier.PROPOSE) {
      const proposal = {
        payload: input,
        would_change: wouldChange,
        preview,
      };
      const record = await this.agentActionLog.record({
        actorType: 'AGENT',
        agentId: context.agentId,
        onBehalfOfUserId: context.onBehalfOfUserId,
        actionType,
        tier,
        status: 'PROPOSED',
        inputSummary,
        resultSummary: proposal,
      });
      const pendingAction = await this.agentProposals.persistPendingAction({
        action_type: execution.policyActionType,
        payload_json: input,
        preview_json: {
          ...proposal,
          ...(executionContext ? { execution_context: executionContext } : {}),
        },
        tier,
        trace_id: record.traceId,
        created_by_agent: context.agentId,
      });
      return {
        tool: execution.toolName,
        tier,
        status: MCP_AGENT_FACING_CODES.needsApprovalStatus,
        would_change: wouldChange,
        proposal,
        pending_action_id: pendingAction.id,
        trace_id: record.traceId,
      };
    }

    const record = await this.agentActionLog.record(
      {
        actorType: 'AGENT',
        agentId: context.agentId,
        onBehalfOfUserId: context.onBehalfOfUserId,
        actionType,
        tier,
        status: 'EXECUTED',
        inputSummary,
        resultSummary: (result) => execution.buildResultSummary(result),
      },
      async () => execution.execute(input),
      execution.buildLogMetadata,
    );

    return {
      tool: execution.toolName,
      tier,
      status: MCP_AGENT_FACING_CODES.executedStatus,
      would_change: wouldChange,
      result: record.workResult,
      trace_id: record.traceId,
    };
  }
}
