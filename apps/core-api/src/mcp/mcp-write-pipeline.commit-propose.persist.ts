import { AgentProposalStatus, type Prisma } from '@prisma/client';
import { replayCustomerProposalIfPending } from '../customer/customer-propose-pending.replay.js';
import type { McpWriteCommandClaim } from './mcp-write-command-idempotency.service.js';
import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit-deps.js';
import { readCustomerProposalFields } from './mcp-write-customer-result.js';
import { MCP_AGENT_FACING_CODES } from './mcp.constants.js';
import type {
  McpWriteCall,
  McpWriteSimulation,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';

export type PersistMcpWriteProposalInput = {
  call: McpWriteCall;
  simulation: McpWriteSimulation;
  proposal: {
    payload: unknown;
    would_change: McpWriteSimulation['wouldChange'];
    preview: unknown;
    provisional: boolean;
  };
  proposalActionType: string;
  proposalPayload: unknown;
  tenantId: string;
  idempotencyMeta?: { command_id: string; args_fingerprint: string };
  claim?: McpWriteCommandClaim;
};

export async function persistMcpWriteProposalInTransaction(
  deps: McpWritePipelineCommitDeps,
  tx: Prisma.TransactionClient,
  input: PersistMcpWriteProposalInput,
): Promise<McpWriteToolResult> {
  const {
    call,
    simulation,
    proposal,
    proposalActionType,
    proposalPayload,
    tenantId,
    idempotencyMeta,
    claim,
  } = input;

  const replayed = await replayCustomerProposalIfPending(tx, {
    tenantId,
    proposalActionType,
    proposalPayload,
    tool: call.execution.toolName,
    tier: call.tier,
  });
  if (replayed) {
    if (claim) {
      await deps.commandIdempotency.completeInTransaction(tx, claim, replayed);
    }
    return replayed;
  }

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
  const customerFields = readCustomerProposalFields(simulation.preview);
  const result: McpWriteToolResult = {
    tool: call.execution.toolName,
    tier: call.tier,
    status: MCP_AGENT_FACING_CODES.needsApprovalStatus,
    would_change: simulation.wouldChange,
    proposal,
    pending_action_id: pendingAction.id,
    trace_id: record.traceId,
    ...customerFields,
  };
  if (claim) {
    await deps.commandIdempotency.completeInTransaction(tx, claim, result);
  }
  return result;
}
