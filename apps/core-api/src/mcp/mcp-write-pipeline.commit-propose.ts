import type { McpWriteCommandClaim } from './mcp-write-command-idempotency.service.js';
import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit-deps.js';
import { tryProposeCustomerMcpWrite } from './mcp-write-pipeline.commit-propose.customer.js';
import { tryProposeVehicleMcpWrite } from './mcp-write-pipeline.commit-propose.vehicle.js';
import { proposeGenericMcpWrite } from './mcp-write-pipeline.commit-propose.generic.js';
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
  const customerProposed = await tryProposeCustomerMcpWrite(
    deps,
    call,
    simulation,
    idempotencyMeta,
    claim,
  );
  if (customerProposed !== undefined) {
    return customerProposed;
  }
  const vehicleProposed = await tryProposeVehicleMcpWrite(
    deps,
    call,
    simulation,
    idempotencyMeta,
    claim,
  );
  if (vehicleProposed !== undefined) {
    return vehicleProposed;
  }
  return proposeGenericMcpWrite(deps, call, simulation, idempotencyMeta, claim);
}
