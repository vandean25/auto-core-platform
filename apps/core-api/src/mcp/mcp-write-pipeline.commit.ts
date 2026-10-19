import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import { MCP_AGENT_FACING_CODES } from './mcp.constants.js';
import { effectiveMcpWriteTier } from './mcp-write-tier.util.js';
import {
  simulateDedicatedDryRunPreview,
  usesDedicatedDryRunPreview,
} from './mcp-write-pipeline.write-tool-dry-run-preview.js';
import type { McpWriteCommandClaim } from './mcp-write-command-idempotency.service.js';
import { executeMcpWrite } from './mcp-write-pipeline.commit-execute.js';
import { proposeMcpWrite } from './mcp-write-pipeline.commit-propose.js';
import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit-deps.js';
import { recordMcpWriteFailure } from './mcp-write-pipeline.commit-failure.js';
import type {
  McpWriteCall,
  McpWriteSimulation,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';

export type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit-deps.js';
export { recordMcpWriteFailure } from './mcp-write-pipeline.commit-failure.js';

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
