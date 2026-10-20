import type { PendingActionExecutor } from '../pending-action-executor/pending-action-executor.types.js';

export type McpWriteOptionalHooks = {
  enrichInput?: (input: unknown) => Promise<unknown>;
  maskProposalPayload?: (payload: unknown) => unknown;
  maskLoggedArgs?: (args: unknown) => unknown;
};

/**
 * The optional hooks of a pending action executor become the optional hooks of
 * the MCP write execution, so both paths build the same proposal payload and
 * mask the same values.
 */
export function mapExecutorHooks(
  executor: PendingActionExecutor,
): McpWriteOptionalHooks {
  return {
    enrichInput: executor.enrichInput
      ? (input) => executor.enrichInput!(input)
      : undefined,
    maskProposalPayload: executor.maskProposalPayload
      ? (payload) => executor.maskProposalPayload!(payload)
      : undefined,
    maskLoggedArgs: executor.maskLoggedArgs
      ? (args) => executor.maskLoggedArgs!(args)
      : undefined,
  };
}
