import type { McpWritePipelineCommitDeps } from './mcp-write-pipeline.commit-deps.js';
import type { McpWriteCall } from './mcp-write-pipeline.types.js';

export async function recordMcpWriteFailure(
  deps: McpWritePipelineCommitDeps,
  call: McpWriteCall,
  error: unknown,
): Promise<void> {
  await deps.agentActionLog.record({
    actorType: 'AGENT',
    agentId: call.context.agentId,
    onBehalfOfUserId: call.context.onBehalfOfUserId,
    actionType: call.actionType,
    tier: call.tier,
    status: 'FAILED',
    inputSummary: call.inputSummary,
    resultSummary: {
      reasons: call.reasons,
      error: error instanceof Error ? error.message : 'Write tool failed',
    },
  });
}
