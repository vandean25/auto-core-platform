import type { McpWriteEnrichInputDeps } from './mcp-write-pipeline.enrich-input.js';
import { enrichMcpWriteInput } from './mcp-write-pipeline.enrich-input.js';
import { readEnrichInputHook } from './mcp-write-pipeline.mask.hooks.js';
import type { McpWriteExecution } from './mcp-write-pipeline.types.js';

export function createNormalizeWriteInput(deps: McpWriteEnrichInputDeps) {
  return async (
    execution: McpWriteExecution,
    value: unknown,
  ): Promise<unknown> => {
    let normalized = await enrichMcpWriteInput(deps, execution, value);
    const enrich = readEnrichInputHook(execution);
    if (enrich) {
      normalized = await enrich(normalized);
    }
    return normalized;
  };
}
