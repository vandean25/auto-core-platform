import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import type { McpWriteCommandClaim } from './mcp-write-command-idempotency.service.js';
import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit-deps.js';
import { recordMcpWriteFailure } from './mcp-write-pipeline.commit-failure.js';
import { MCP_AGENT_FACING_CODES } from './mcp.constants.js';
import type {
  McpWriteCall,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';

export async function executeMcpWrite(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
  wouldChange: WouldChangeItem[],
  claim?: McpWriteCommandClaim,
): Promise<McpWriteToolResult> {
  try {
    const workResult = call.execution.executeOutsideTransaction
      ? await call.execution.execute(call.input)
      : undefined;
    return await deps.prisma.$transaction(async (tx) => {
      const record = await deps.agentActionLog.recordInTransaction(
        {
          actorType: 'AGENT',
          agentId: call.context.agentId,
          onBehalfOfUserId: call.context.onBehalfOfUserId,
          actionType: call.actionType,
          tier: call.tier,
          status: 'EXECUTED',
          inputSummary: call.inputSummary,
          resultSummary: (result) => call.execution.buildResultSummary(result),
        },
        tx,
        workResult !== undefined
          ? () => Promise.resolve(workResult)
          : () =>
              DryRunStorage.run({ isDryRun: false, tx }, () =>
                call.execution.execute(call.input),
              ),
        call.execution.buildLogMetadata,
      );
      const result: McpWriteToolResult = {
        tool: call.execution.toolName,
        tier: call.tier,
        status: MCP_AGENT_FACING_CODES.executedStatus,
        would_change: wouldChange,
        result: record.workResult,
        trace_id: record.traceId,
      };
      if (claim) {
        await deps.commandIdempotency.completeInTransaction(tx, claim, result);
      }
      return result;
    });
  } catch (error) {
    await recordMcpWriteFailure(deps, call, error);
    throw error;
  }
}
