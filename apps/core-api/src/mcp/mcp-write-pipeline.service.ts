import { ForbiddenException, Injectable } from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { AgentActionRecordInput } from '../agent-action-log/agent-action-log.types.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import {
  MCP_AGENT_FACING_CODES,
  type McpWriteToolName,
} from './mcp.constants.js';

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
  execute: (input: unknown) => Promise<unknown>;
  buildResultSummary: (result: unknown) => unknown;
  buildLogMetadata?: (
    result: unknown,
  ) => Pick<AgentActionRecordInput, 'entityType' | 'entityId' | 'reversible'>;
};

export type McpWriteToolResult = {
  tool: McpWriteToolName;
  tier: AgentPolicyTier;
  status: 'executed' | 'needs_human_approval';
  would_change: WouldChangeItem[];
  result?: unknown;
  proposal?: unknown;
  trace_id?: string;
};

const logActionType = (toolName: McpWriteToolName): string => `mcp.${toolName}`;

@Injectable()
export class McpWritePipelineService {
  constructor(
    private readonly agentPolicy: AgentPolicyService,
    private readonly dryRun: DryRunService,
    private readonly agentActionLog: AgentActionLogService,
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
      tier = evaluation.tier;
      reasons = evaluation.reasons;

      if (
        execution.toolName === 'propose_line_item' &&
        tier === AgentPolicyTier.AUTO
      ) {
        tier = AgentPolicyTier.PROPOSE;
      }
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
      const previewResult = await this.dryRun.executeInRollbackTransaction(() =>
        execution.execute(input),
      );
      preview = previewResult.result;
      wouldChange = previewResult.wouldChange;
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
      return {
        tool: execution.toolName,
        tier,
        status: MCP_AGENT_FACING_CODES.needsHumanApprovalStatus,
        would_change: wouldChange,
        proposal,
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
