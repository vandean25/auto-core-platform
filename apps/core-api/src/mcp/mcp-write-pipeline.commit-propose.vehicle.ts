import type { McpWriteCommandClaim } from './mcp-write-command-idempotency.service.js';
import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit-deps.js';
import { proposeMcpWriteViaPersist } from './mcp-write-pipeline.commit-propose.persist-path.js';
import type {
  McpWriteCall,
  McpWriteSimulation,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';
import type { McpWriteToolName } from './mcp.constants.js';

const VEHICLE_PROPOSE_TOOLS = new Set<McpWriteToolName>([
  'propose_vehicle_create',
  'propose_vehicle_update',
]);

/** Vehicle PROPOSE path; returns undefined for other tools. */
export async function tryProposeVehicleMcpWrite(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
  simulation: McpWriteSimulation,
  idempotencyMeta?: { command_id: string; args_fingerprint: string },
  claim?: McpWriteCommandClaim,
): Promise<McpWriteToolResult | undefined> {
  if (!VEHICLE_PROPOSE_TOOLS.has(call.execution.toolName)) {
    return undefined;
  }
  return proposeMcpWriteViaPersist(
    deps,
    call,
    simulation,
    {
      proposalActionType: call.execution.policyActionType,
      proposalPayload: call.input,
      proposalPreview: simulation.preview,
    },
    idempotencyMeta,
    claim,
  );
}
