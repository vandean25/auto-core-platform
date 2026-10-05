import { ForbiddenException, Injectable } from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import type { McpWriteToolName } from './mcp.constants.js';

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

    const policyContext = await execution.buildPolicyContext(input);
    const evaluation = await this.agentPolicy.evaluateAction(
      execution.policyActionType,
      policyContext,
    );
    const tier = evaluation.tier;

    const { result: preview, wouldChange } =
      await this.dryRun.executeInRollbackTransaction(() =>
        execution.execute(input),
      );

    if (tier === AgentPolicyTier.HUMAN_ONLY) {
      await this.agentActionLog.record({
        actorType: 'AGENT',
        agentId: context.agentId,
        onBehalfOfUserId: context.onBehalfOfUserId,
        actionType,
        tier,
        status: 'REFUSED',
        inputSummary,
        resultSummary: {
          reasons: evaluation.reasons,
          would_change: wouldChange,
        },
      });
      throw new ForbiddenException(
        `Action ${execution.policyActionType} requires human approval and was refused.`,
      );
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
        status: 'needs_human_approval',
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
    );

    return {
      tool: execution.toolName,
      tier,
      status: 'executed',
      would_change: wouldChange,
      result: record.workResult,
      trace_id: record.traceId,
    };
  }
}
