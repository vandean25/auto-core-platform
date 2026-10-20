import type { McpWriteCommandClaim } from './mcp-write-command-idempotency.service.js';
import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit-deps.js';
import { recordMcpWriteFailure } from './mcp-write-pipeline.commit-failure.js';
import { persistMcpWriteProposalInTransaction } from './mcp-write-pipeline.commit-propose.persist.js';
import { readMaskProposalPayloadHook } from './mcp-write-pipeline.mask.hooks.js';
import type {
  McpWriteCall,
  McpWriteSimulation,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';

/** Customer PROPOSE commits with idempotency replay and masked proposal payloads. */
export async function proposeMcpWriteViaPersist(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
  simulation: McpWriteSimulation,
  input: {
    proposalActionType: string;
    proposalPayload: unknown;
    proposalPreview: unknown;
  },
  idempotencyMeta?: { command_id: string; args_fingerprint: string },
  claim?: McpWriteCommandClaim,
): Promise<McpWriteToolResult> {
  const proposal = {
    payload: maskProposalPayload(call, input.proposalPayload),
    would_change: simulation.wouldChange,
    preview: input.proposalPreview,
    provisional: true,
  };
  const tenantId = await deps.tenantContext.getTenantId();
  try {
    return await deps.prisma.$transaction((tx) =>
      persistMcpWriteProposalInTransaction(deps, tx, {
        call,
        simulation,
        proposal,
        proposalActionType: input.proposalActionType,
        proposalPayload: input.proposalPayload,
        tenantId,
        idempotencyMeta,
        claim,
      }),
    );
  } catch (error) {
    await recordMcpWriteFailure(deps, call, error);
    throw error;
  }
}

function maskProposalPayload(call: McpWriteCall, payload: unknown): unknown {
  const mask = readMaskProposalPayloadHook(call.execution);
  if (!mask) {
    return payload;
  }
  return mask(payload);
}
