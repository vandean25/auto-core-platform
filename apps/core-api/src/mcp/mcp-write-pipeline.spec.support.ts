import type { McpWritePipelineRunResult } from './mcp-write-pipeline.run.js';
import type { McpWriteToolResult } from './mcp-write-pipeline.types.js';

export function expectCommitted(
  result: McpWritePipelineRunResult,
): asserts result is McpWriteToolResult {
  if ('dry_run' in result) {
    throw new Error('expected a committed write result, got a dry run');
  }
}
