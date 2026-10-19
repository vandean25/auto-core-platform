import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus, Prisma } from '@prisma/client';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import { MCP_AGENT_FACING_CODES } from './mcp.constants.js';
import { effectiveMcpWriteTier } from './mcp-write-tier.util.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type {
  McpWriteCommandClaim,
  McpWriteCommandIdempotencyService,
} from './mcp-write-command-idempotency.service.js';
import type { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import type { WorkshopMediaUploadMcpService } from '../mechanic/workshop-media-upload-mcp.service.js';
import type { WeeklyReportMcpService } from '../reports/weekly-report/weekly-report-mcp.service.js';
import type { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import {
  simulateDedicatedDryRunPreview,
  usesDedicatedDryRunPreview,
} from './mcp-write-pipeline.write-tool-dry-run-preview.js';
import { MECHANIC_FINDING_ACTION_TYPE } from '../mechanic/mechanic-finding.constants.js';
import type {
  McpWriteCall,
  McpWriteSimulation,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';

export type McpWritePipelineCommitDeps = {
  prisma: PrismaService;
  agentPolicy: AgentPolicyService;
  dryRun: DryRunService;
  agentActionLog: AgentActionLogService;
  tenantContext: TenantContextService;
  commandIdempotency: McpWriteCommandIdempotencyService;
  mechanicFindingPropose: MechanicFindingProposeService;
  workshopEstimateSendPropose: WorkshopEstimateSendProposeService;
  workshopMediaUploadMcp: WorkshopMediaUploadMcpService;
  weeklyReportMcp: WeeklyReportMcpService;
};

export async function evaluateMcpWritePolicy(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
): Promise<void> {
  try {
    const policyContext = await call.execution.buildPolicyContext(call.input);
    const evaluation = await deps.agentPolicy.evaluateAction(
      call.execution.policyActionType,
      policyContext,
    );
    call.tier = effectiveMcpWriteTier(call.execution.toolName, evaluation.tier);
    call.reasons = evaluation.reasons;
  } catch (error) {
    await recordMcpWriteFailure(deps, call, error);
    throw error;
  }
}

export async function refuseMcpWrite(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
): Promise<never> {
  await deps.agentActionLog.record({
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

export async function simulateMcpWrite(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
): Promise<McpWriteSimulation> {
  try {
    const executionContext =
      call.tier === AgentPolicyTier.PROPOSE
        ? await call.execution.buildExecutionContext?.(call.input)
        : undefined;
    const previewResult = usesDedicatedDryRunPreview(call.execution.toolName)
      ? await simulateDedicatedDryRunPreview(deps, call, executionContext)
      : call.execution.preview
        ? {
            result: await call.execution.preview(call.input, executionContext),
            wouldChange: [] as WouldChangeItem[],
          }
        : await deps.dryRun.executeInRollbackTransaction(() =>
            call.execution.execute(call.input, executionContext),
          );
    if (executionContext?.site_id !== undefined) {
      await assertMcpWriteActiveSiteUnchanged(deps, call, executionContext);
    }
    return {
      preview: previewResult.result,
      wouldChange: previewResult.wouldChange,
      executionContext,
    };
  } catch (error) {
    await recordMcpWriteFailure(deps, call, error);
    throw error;
  }
}

async function assertMcpWriteActiveSiteUnchanged(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
  executionContext: Record<string, unknown>,
): Promise<void> {
  const appliedContext = await call.execution.buildExecutionContext?.(
    call.input,
  );
  if (appliedContext?.site_id !== executionContext.site_id) {
    throw new ConflictException(
      'The active site changed while the pending action was simulated',
    );
  }
}

export async function proposeMcpWrite(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
  simulation: McpWriteSimulation,
  idempotencyMeta?: { command_id: string; args_fingerprint: string },
  claim?: McpWriteCommandClaim,
): Promise<McpWriteToolResult> {
  let proposalPayload: unknown = call.input;
  let proposalActionType = call.execution.policyActionType;
  let proposalPreview: unknown = simulation.preview;
  if (call.execution.toolName === 'propose_estimate_send') {
    proposalActionType = 'estimate.send_customer_message';
  }
  if (call.execution.toolName === 'propose_mechanic_finding') {
    const built = await deps.mechanicFindingPropose.buildProposalPayload(
      call.input,
      call.context.agentId,
    );
    proposalPayload = built.payload_json;
    proposalActionType = MECHANIC_FINDING_ACTION_TYPE;
    proposalPreview = {
      ...built.preview_json,
      would_change: simulation.wouldChange,
    };
  }
  const proposal = {
    payload: proposalPayload,
    would_change: simulation.wouldChange,
    preview: proposalPreview,
    provisional: true,
  };
  try {
    return await deps.prisma.$transaction(async (tx) => {
      const record = await deps.agentActionLog.recordInTransaction(
        {
          actorType: 'AGENT',
          agentId: call.context.agentId,
          onBehalfOfUserId: call.context.onBehalfOfUserId,
          actionType: call.actionType,
          tier: call.tier,
          status: 'PROPOSED',
          inputSummary: call.inputSummary,
          resultSummary: proposal,
        },
        tx,
      );
      const tenantId = await deps.tenantContext.getTenantId();
      const pendingAction = await tx.agentProposal.create({
        data: {
          tenant_id: tenantId,
          trace_id: record.traceId,
          action_type: proposalActionType,
          payload_json: proposalPayload as Prisma.InputJsonValue,
          preview_json: JSON.parse(
            JSON.stringify({
              ...proposal,
              ...(simulation.executionContext
                ? { execution_context: simulation.executionContext }
                : {}),
              ...(idempotencyMeta
                ? { mcp_command_idempotency: idempotencyMeta }
                : {}),
            }),
          ) as Prisma.InputJsonValue,
          tier: call.tier,
          status: AgentProposalStatus.PENDING,
          created_by_agent: call.context.agentId,
        },
      });
      const result: McpWriteToolResult = {
        tool: call.execution.toolName,
        tier: call.tier,
        status: MCP_AGENT_FACING_CODES.needsApprovalStatus,
        would_change: simulation.wouldChange,
        proposal,
        pending_action_id: pendingAction.id,
        trace_id: record.traceId,
      };
      if (claim) {
        await deps.commandIdempotency.completeInTransaction(tx, claim, result);
      }
      return result;
    });
  } catch (error) {
    await recordMcpWriteFailure(deps, call, error);
    throw error;
  }
}

export async function executeMcpWrite(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
  wouldChange: WouldChangeItem[],
  claim?: McpWriteCommandClaim,
): Promise<McpWriteToolResult> {
  try {
    const workResult = call.execution.executeOutsideTransaction
      ? await call.execution.execute(call.input)
      : undefined;
    return await deps.prisma.$transaction(async (tx) => {
      const record = await deps.agentActionLog.recordInTransaction(
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
        tx,
        workResult !== undefined
          ? () => Promise.resolve(workResult)
          : () =>
              DryRunStorage.run({ isDryRun: false, tx }, () =>
                call.execution.execute(call.input),
              ),
        call.execution.buildLogMetadata,
      );
      const result: McpWriteToolResult = {
        tool: call.execution.toolName,
        tier: call.tier,
        status: MCP_AGENT_FACING_CODES.executedStatus,
        would_change: wouldChange,
        result: record.workResult,
        trace_id: record.traceId,
      };
      if (claim) {
        await deps.commandIdempotency.completeInTransaction(tx, claim, result);
      }
      return result;
    });
  } catch (error) {
    await recordMcpWriteFailure(deps, call, error);
    throw error;
  }
}

export async function decideMcpWriteCommit(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
  idempotencyMeta?: { command_id: string; args_fingerprint: string },
  claim?: McpWriteCommandClaim,
): Promise<McpWriteToolResult> {
  if (call.tier === AgentPolicyTier.HUMAN_ONLY) {
    return refuseMcpWrite(deps, call);
  }
  const simulation = await simulateMcpWrite(deps, call);
  if (call.tier === AgentPolicyTier.PROPOSE) {
    return proposeMcpWrite(deps, call, simulation, idempotencyMeta, claim);
  }
  return executeMcpWrite(deps, call, simulation.wouldChange, claim);
}

export async function recordMcpWriteFailure(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
  error: unknown,
): Promise<void> {
  await deps.agentActionLog.record({
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
