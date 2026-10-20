import type {
  McpWriteExecution,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';
import {
  readMaskLoggedArgsHook,
  readMaskProposalPayloadHook,
} from './mcp-write-pipeline.mask.hooks.js';

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

/** A replayed proposal keeps the stored payload, so the result shows the masked copy. */
export function maskReplayedProposal(
  execution: McpWriteExecution,
  result: McpWriteToolResult,
): McpWriteToolResult {
  const mask = readMaskProposalPayloadHook(execution);
  if (!mask || !isProposalRecord(result.proposal)) {
    return result;
  }
  const proposal = result.proposal;
  if (proposal.payload === undefined) {
    return result;
  }
  return {
    ...result,
    proposal: { ...proposal, payload: mask(proposal.payload) },
  };
}

function isProposalRecord(value: unknown): value is { payload?: unknown } {
  return typeof value === 'object' && value !== null;
}
