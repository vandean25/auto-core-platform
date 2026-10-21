import type { McpWriteExecution } from './mcp-write-pipeline.types.js';
import { readMaskLoggedArgsHook } from './mcp-write-pipeline.mask.hooks.js';

/**
 * The action log shows masked values, so a write tool that carries personal
 * data masks its raw arguments before they are logged.
 */
export function maskLoggedArgs(
  execution: McpWriteExecution,
  args: unknown,
): unknown {
  const mask = readMaskLoggedArgsHook(execution);
  if (!mask) {
    return args;
  }
  return mask(args);
}
