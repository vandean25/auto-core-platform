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

/** One write call as it moves through the pipeline. Tier and reasons are filled in by the policy step. */
type WriteCall = {
  execution: McpWriteExecution;
  input: unknown;
  context: McpWriteToolContext;
  actionType: string;
  inputSummary: { tool: McpWriteToolName; args: unknown };
  tier: AgentPolicyTier;
  reasons: string[];
};

type WriteSimulation = {
  preview: unknown;
  wouldChange: WouldChangeItem[];
  executionContext?: Record<string, unknown>;
};

const logActionType = (toolName: McpWriteToolName): string => `mcp.${toolName}`;

@Injectable()
export class McpWritePipelineService {
  private readonly agentPolicy: AgentPolicyService;
  private readonly dryRun: DryRunService;
  private readonly agentActionLog: AgentActionLogService;
  private readonly agentProposals: AgentProposalService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    agentPolicy: AgentPolicyService,
    dryRun: DryRunService,
    agentActionLog: AgentActionLogService,
    agentProposals: AgentProposalService,
  ) {
    this.agentPolicy = agentPolicy;
    this.dryRun = dryRun;
    this.agentActionLog = agentActionLog;
    this.agentProposals = agentProposals;
  }

  /** Runs one write call: policy, then refusal, a rollback preview, and either a proposal or the write. */
  async run(
    execution: McpWriteExecution,
    input: unknown,
    context: McpWriteToolContext,
  ): Promise<McpWriteToolResult> {
    const call: WriteCall = {
      execution,
      input,
      context,
      actionType: logActionType(execution.toolName),
      inputSummary: { tool: execution.toolName, args: input },
      tier: AgentPolicyTier.PROPOSE,
      reasons: [],
    };

    await this.evaluatePolicy(call);
    if (call.tier === AgentPolicyTier.HUMAN_ONLY) {
      return this.refuse(call);
    }

    const simulation = await this.simulate(call);
    if (call.tier === AgentPolicyTier.PROPOSE) {
      return this.propose(call, simulation);
    }
    return this.execute(call, simulation.wouldChange);
  }

  private async evaluatePolicy(call: WriteCall): Promise<void> {
    try {
      const policyContext = await call.execution.buildPolicyContext(call.input);
      const evaluation = await this.agentPolicy.evaluateAction(
        call.execution.policyActionType,
        policyContext,
      );
      call.tier = effectiveMcpWriteTier(
        call.execution.toolName,
        evaluation.tier,
      );
      call.reasons = evaluation.reasons;
    } catch (error) {
      await this.recordFailure(call, error);
      throw error;
    }
  }

  private async refuse(call: WriteCall): Promise<never> {
    await this.agentActionLog.record({
      actorType: 'AGENT',
      agentId: call.context.agentId,
      onBehalfOfUserId: call.context.onBehalfOfUserId,
      actionType: call.actionType,
      tier: call.tier,
      status: MCP_AGENT_FACING_CODES.refusedLogStatus,
      inputSummary: call.inputSummary,
      resultSummary: { reasons: call.reasons },
    });
    throw new ForbiddenException({
      code: MCP_AGENT_FACING_CODES.notPermitted,
      message: `${MCP_AGENT_FACING_CODES.notPermitted}: Action ${call.execution.policyActionType} requires human approval and was refused.`,
    });
  }

  /** Previews the write inside a rollback transaction, and checks the active site did not move under a pending action. */
  private async simulate(call: WriteCall): Promise<WriteSimulation> {
    try {
      const executionContext =
        call.tier === AgentPolicyTier.PROPOSE
          ? await call.execution.buildExecutionContext?.()
          : undefined;
      const previewResult = await this.dryRun.executeInRollbackTransaction(() =>
        call.execution.execute(call.input, executionContext),
      );
      if (executionContext?.site_id !== undefined) {
        await this.assertActiveSiteUnchanged(call, executionContext);
      }
      return {
        preview: previewResult.result,
        wouldChange: previewResult.wouldChange,
        executionContext,
      };
    } catch (error) {
      await this.recordFailure(call, error);
      throw error;
    }
  }

  private async assertActiveSiteUnchanged(
    call: WriteCall,
    executionContext: Record<string, unknown>,
  ): Promise<void> {
    const appliedContext = await call.execution.buildExecutionContext?.();
    if (appliedContext?.site_id !== executionContext.site_id) {
      throw new ConflictException(
        'The active site changed while the pending action was simulated',
      );
    }
  }

  private async propose(
    call: WriteCall,
    simulation: WriteSimulation,
  ): Promise<McpWriteToolResult> {
    const proposal = {
      payload: call.input,
      would_change: simulation.wouldChange,
      preview: simulation.preview,
    };
    const record = await this.agentActionLog.record({
      actorType: 'AGENT',
      agentId: call.context.agentId,
      onBehalfOfUserId: call.context.onBehalfOfUserId,
      actionType: call.actionType,
      tier: call.tier,
      status: 'PROPOSED',
      inputSummary: call.inputSummary,
      resultSummary: proposal,
    });
    const pendingAction = await this.agentProposals.persistPendingAction({
      action_type: call.execution.policyActionType,
      payload_json: call.input,
      preview_json: {
        ...proposal,
        ...(simulation.executionContext
          ? { execution_context: simulation.executionContext }
          : {}),
      },
      tier: call.tier,
      trace_id: record.traceId,
      created_by_agent: call.context.agentId,
    });
    return {
      tool: call.execution.toolName,
      tier: call.tier,
      status: MCP_AGENT_FACING_CODES.needsApprovalStatus,
      would_change: simulation.wouldChange,
      proposal,
      pending_action_id: pendingAction.id,
      trace_id: record.traceId,
    };
  }

  private async execute(
    call: WriteCall,
    wouldChange: WouldChangeItem[],
  ): Promise<McpWriteToolResult> {
    const record = await this.agentActionLog.record(
      {
        actorType: 'AGENT',
        agentId: call.context.agentId,
        onBehalfOfUserId: call.context.onBehalfOfUserId,
        actionType: call.actionType,
        tier: call.tier,
        status: 'EXECUTED',
        inputSummary: call.inputSummary,
        resultSummary: (result) => call.execution.buildResultSummary(result),
      },
      async () => call.execution.execute(call.input),
      call.execution.buildLogMetadata,
    );

    return {
      tool: call.execution.toolName,
      tier: call.tier,
      status: MCP_AGENT_FACING_CODES.executedStatus,
      would_change: wouldChange,
      result: record.workResult,
      trace_id: record.traceId,
    };
  }

  private async recordFailure(call: WriteCall, error: unknown): Promise<void> {
    await this.agentActionLog.record({
      actorType: 'AGENT',
      agentId: call.context.agentId,
      onBehalfOfUserId: call.context.onBehalfOfUserId,
      actionType: call.actionType,
      tier: call.tier,
      status: 'FAILED',
      inputSummary: call.inputSummary,
      resultSummary: {
        reasons: call.reasons,
        error: error instanceof Error ? error.message : 'Write tool failed',
      },
    });
  }
}
