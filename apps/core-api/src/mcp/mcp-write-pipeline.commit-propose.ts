import { AgentProposalStatus, Prisma } from '@prisma/client';
import type { McpWriteCommandClaim } from './mcp-write-command-idempotency.service.js';
import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit-deps.js';
import { recordMcpWriteFailure } from './mcp-write-pipeline.commit-failure.js';
import { MCP_AGENT_FACING_CODES } from './mcp.constants.js';
import { MECHANIC_FINDING_ACTION_TYPE } from '../mechanic/mechanic-finding.constants.js';
import type {
  McpWriteCall,
  McpWriteSimulation,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';

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
