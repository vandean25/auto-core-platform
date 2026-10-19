import { AgentPolicyTier } from '@prisma/client';
import { agentPolicyOutcome } from '../agent-policy/agent-policy.evaluator.js';
import { withSpan } from '../common/observability/trace.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import type { McpWriteCommandClaim } from './mcp-write-command-idempotency.service.js';
import {
  decideMcpWriteCommit,
  evaluateMcpWritePolicy,
  type McpWritePipelineCommitDeps,
} from './mcp-write-pipeline.commit.js';
import type {
  McpWriteCall,
  McpWriteExecution,
  McpWriteToolContext,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';
import type { McpWriteToolName } from './mcp.constants.js';

export async function runMcpWriteExecutePath(input: {
  commitDeps: McpWritePipelineCommitDeps;
  execution: McpWriteExecution;
  workInput: unknown;
  context: McpWriteToolContext;
  loggedInput: unknown;
  idempotencyMeta?: { command_id: string; args_fingerprint: string };
  claim?: McpWriteCommandClaim;
  normalizeWriteInput: (
    execution: McpWriteExecution,
    value: unknown,
  ) => Promise<unknown>;
  logActionType: (toolName: McpWriteToolName) => string;
}): Promise<McpWriteToolResult> {
  const normalizedInput = await input.normalizeWriteInput(
    input.execution,
    input.workInput,
  );
  const call: McpWriteCall = {
    execution: input.execution,
    input: normalizedInput,
    context: input.context,
    actionType: input.logActionType(input.execution.toolName),
    inputSummary: { tool: input.execution.toolName, args: input.loggedInput },
    tier: AgentPolicyTier.PROPOSE,
    reasons: [],
  };

  return withSpan(
    'Agent action',
    'agent.action',
    {
      'agent.action.type': call.actionType,
      'agent.trace_id': TenantContextStorage.getRequestMeta()?.traceId,
    },
    async (span) => {
      await evaluateMcpWritePolicy(input.commitDeps, call);
      span.setAttribute('agent.policy.tier', call.tier);

      const result = await withSpan(
        'Agent decision',
        'agent.decision',
        { 'agent.policy.outcome': agentPolicyOutcome(call.tier) },
        () =>
          decideMcpWriteCommit(
            input.commitDeps,
            call,
            input.idempotencyMeta,
            input.claim,
          ),
      );
      if (result.trace_id) {
        span.setAttribute('agent.trace_id', result.trace_id);
      }
      return result;
    },
  );
}
