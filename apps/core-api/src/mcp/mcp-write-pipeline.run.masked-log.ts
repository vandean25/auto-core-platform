import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import { parseMcpWriteCommandInput } from './mcp-write-command-idempotency.util.js';
import { resolveMcpWriteCommandGate } from './mcp-write-command-idempotency.gate.js';
import type { McpWriteDryRunResult } from './mcp-write-dry-run.util.js';
import { runMcpWriteDryRunPath } from './mcp-write-pipeline.dry-run-path.js';
import { runMcpWriteExecutePath } from './mcp-write-pipeline.execute-path.js';
import type { McpWriteEnrichInputDeps } from './mcp-write-pipeline.enrich-input.js';
import { createNormalizeWriteInput } from './mcp-write-pipeline.normalize-write-input.js';
import { maskLoggedArgs } from './mcp-write-pipeline.mask.js';
import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit.js';
import type {
  McpWriteCall,
  McpWriteExecution,
  McpWriteSimulation,
  McpWriteToolContext,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';
import type { McpWriteToolName } from './mcp.constants.js';

export type McpWritePipelineRunResult =
  McpWriteToolResult | McpWriteDryRunResult;

/** Same as `runMcpWritePipeline`, but action-log args pass through executor mask hooks. */
export async function runMcpWritePipeline(input: {
  execution: McpWriteExecution;
  rawInput: unknown;
  context: McpWriteToolContext;
  commitDeps: McpWritePipelineCommitDeps;
  enrichDeps: McpWriteEnrichInputDeps;
  commandIdempotency: McpWriteCommandIdempotencyService;
  requestContext: RequestContextService;
  agentActionLog: AgentActionLogService;
  evaluatePolicy: (call: McpWriteCall) => Promise<void>;
  simulate: (call: McpWriteCall) => Promise<McpWriteSimulation>;
  recordFailure: (call: McpWriteCall, error: unknown) => Promise<void>;
  logActionType: (toolName: McpWriteToolName) => string;
}): Promise<McpWritePipelineRunResult> {
  const parsed = parseMcpWriteCommandInput(input.rawInput);
  const workInput = parsed.businessInput;
  const loggedInput = maskLoggedArgs(input.execution, input.rawInput);
  const normalizeWriteInput = createNormalizeWriteInput(input.enrichDeps);

  if (parsed.dryRun) {
    return runMcpWriteDryRunPath({
      execution: input.execution,
      workInput,
      context: input.context,
      loggedInput,
      normalizeWriteInput,
      evaluatePolicy: input.evaluatePolicy,
      simulate: input.simulate,
      recordFailure: input.recordFailure,
      agentActionLog: input.agentActionLog,
      logActionType: input.logActionType,
    });
  }

  const commandGate = await resolveMcpWriteCommandGate(
    input.commandIdempotency,
    {
      parsed,
      toolName: input.execution.toolName,
      workInput,
      context: input.context,
      traceId: input.requestContext.getTraceId(),
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
    return await runMcpWriteExecutePath({
      commitDeps: input.commitDeps,
      execution: input.execution,
      workInput,
      context: input.context,
      loggedInput,
      idempotencyMeta,
      claim,
      normalizeWriteInput,
      logActionType: input.logActionType,
    });
  } catch (error) {
    if (claim) {
      await input.commandIdempotency.abandon(claim);
    }
    throw error;
  }
}
