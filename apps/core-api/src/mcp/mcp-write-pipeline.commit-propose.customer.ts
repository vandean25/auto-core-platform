import type { McpWriteCommandClaim } from './mcp-write-command-idempotency.service.js';
import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit-deps.js';
import { proposeMcpWriteViaPersist } from './mcp-write-pipeline.commit-propose.persist-path.js';
import type {
  McpWriteCall,
  McpWriteSimulation,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';
import type { McpWriteToolName } from './mcp.constants.js';

const CUSTOMER_PROPOSE_TOOLS = new Set<McpWriteToolName>([
  'propose_customer_create',
  'propose_customer_update',
]);

export function isCustomerMcpProposeTool(toolName: McpWriteToolName): boolean {
  return CUSTOMER_PROPOSE_TOOLS.has(toolName);
}

/** Customer PROPOSE path; returns undefined for other tools. */
export async function tryProposeCustomerMcpWrite(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
  simulation: McpWriteSimulation,
  idempotencyMeta?: { command_id: string; args_fingerprint: string },
  claim?: McpWriteCommandClaim,
): Promise<McpWriteToolResult | undefined> {
  if (!CUSTOMER_PROPOSE_TOOLS.has(call.execution.toolName)) {
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
