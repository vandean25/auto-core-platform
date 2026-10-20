import type { McpWriteExecution } from './mcp-write-pipeline.types.js';
import type { McpWriteOptionalHooks } from './mcp-write-execution-hooks.js';

export function readMaskLoggedArgsHook(
  execution: McpWriteExecution,
): McpWriteOptionalHooks['maskLoggedArgs'] {
  return (execution as McpWriteExecution & McpWriteOptionalHooks)
    .maskLoggedArgs;
}

export function readMaskProposalPayloadHook(
  execution: McpWriteExecution,
): McpWriteOptionalHooks['maskProposalPayload'] {
  return (execution as McpWriteExecution & McpWriteOptionalHooks)
    .maskProposalPayload;
}

export function readEnrichInputHook(
  execution: McpWriteExecution,
): McpWriteOptionalHooks['enrichInput'] {
  return (execution as McpWriteExecution & McpWriteOptionalHooks).enrichInput;
}
