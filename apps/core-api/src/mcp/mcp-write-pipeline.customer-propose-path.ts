import type { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import { parseMcpWriteCommandInput } from './mcp-write-command-idempotency.util.js';
import { resolveMcpWriteCommandGate } from './mcp-write-command-idempotency.gate.js';
import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit.js';
import type { McpWriteEnrichInputDeps } from './mcp-write-pipeline.enrich-input.js';
import { createNormalizeWriteInput } from './mcp-write-pipeline.normalize-write-input.js';
import { maskLoggedArgs } from './mcp-write-pipeline.mask.js';
import {
  buildCustomerProposeMcpCall,
  runCustomerProposePolicyAndPersist,
} from './mcp-write-pipeline.customer-propose-path.support.js';
import type {
  McpWriteExecution,
  McpWriteToolContext,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';
import type { McpWriteToolName } from './mcp.constants.js';

export { isCustomerMcpProposeTool } from './mcp-write-pipeline.commit-propose.customer.js';

export async function runCustomerMcpProposePath(input: {
  execution: McpWriteExecution;
  rawInput: unknown;
  context: McpWriteToolContext;
  commitDeps: McpWritePipelineCommitDeps;
  enrichDeps: McpWriteEnrichInputDeps;
  commandIdempotency: McpWriteCommandIdempotencyService;
  traceId: string | undefined;
  logActionType: (toolName: McpWriteToolName) => string;
}): Promise<McpWriteToolResult> {
  const parsed = parseMcpWriteCommandInput(input.rawInput);
  const workInput = parsed.businessInput;
  const loggedInput = maskLoggedArgs(input.execution, input.rawInput);

  const commandGate = await resolveMcpWriteCommandGate(
    input.commandIdempotency,
    {
      parsed,
      toolName: input.execution.toolName,
      workInput,
      context: input.context,
      traceId: input.traceId,
    },
  );
  if (commandGate.kind === 'replay') {
    if (input.execution.refreshReplayResult) {
      return input.execution.refreshReplayResult(commandGate.result);
    }
    return commandGate.result;
  }
  const claim = commandGate.kind === 'claimed' ? commandGate.claim : undefined;
  const idempotencyMeta =
    commandGate.kind === 'claimed' ? commandGate.idempotencyMeta : undefined;

  try {
    const normalizedInput = await createNormalizeWriteInput(input.enrichDeps)(
      input.execution,
      workInput,
    );
    const call = buildCustomerProposeMcpCall({
      execution: input.execution,
      context: input.context,
      normalizedInput,
      loggedInput,
      logActionType: input.logActionType,
    });

    return runCustomerProposePolicyAndPersist({
      commitDeps: input.commitDeps,
      call,
      idempotencyMeta,
      claim,
    });
  } catch (error) {
    if (claim) {
      await input.commandIdempotency.abandon(claim);
    }
    throw error;
  }
}
