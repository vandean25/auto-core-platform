import { AgentPolicyTier } from '@prisma/client';
import { agentPolicyOutcome } from '../agent-policy/agent-policy.evaluator.js';
import { withSpan } from '../common/observability/trace.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import type { McpWriteCommandClaim } from './mcp-write-command-idempotency.service.js';
import {
  evaluateMcpWritePolicy,
  simulateMcpWrite,
  type McpWritePipelineCommitDeps,
} from './mcp-write-pipeline.commit.js';
import { tryProposeCustomerMcpWrite } from './mcp-write-pipeline.commit-propose.customer.js';
import type {
  McpWriteCall,
  McpWriteExecution,
  McpWriteToolContext,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';
import type { McpWriteToolName } from './mcp.constants.js';

export function buildCustomerProposeMcpCall(input: {
  execution: McpWriteExecution;
  context: McpWriteToolContext;
  normalizedInput: unknown;
  loggedInput: unknown;
  logActionType: (toolName: McpWriteToolName) => string;
}): McpWriteCall {
  return {
    execution: input.execution,
    input: input.normalizedInput,
    context: input.context,
    actionType: input.logActionType(input.execution.toolName),
    inputSummary: { tool: input.execution.toolName, args: input.loggedInput },
    tier: AgentPolicyTier.PROPOSE,
    reasons: [],
  };
}

export async function runCustomerProposePolicyAndPersist(input: {
  commitDeps: McpWritePipelineCommitDeps;
  call: McpWriteCall;
  idempotencyMeta?: { command_id: string; args_fingerprint: string };
  claim?: McpWriteCommandClaim;
}): Promise<McpWriteToolResult> {
  return withSpan(
    'Agent action',
    'agent.action',
    {
      'agent.action.type': input.call.actionType,
      'agent.trace_id': TenantContextStorage.getRequestMeta()?.traceId,
    },
    async (span) => {
      await evaluateMcpWritePolicy(input.commitDeps, input.call);
      span.setAttribute('agent.policy.tier', input.call.tier);

      const result = await withSpan(
        'Agent decision',
        'agent.decision',
        { 'agent.policy.outcome': agentPolicyOutcome(input.call.tier) },
        async () => {
          const simulation = await simulateMcpWrite(
            input.commitDeps,
            input.call,
          );
          const proposed = await tryProposeCustomerMcpWrite(
            input.commitDeps,
            input.call,
            simulation,
            input.idempotencyMeta,
            input.claim,
          );
          if (proposed === undefined) {
            throw new Error(
              `Expected customer propose path for ${input.call.execution.toolName}`,
            );
          }
          return proposed;
        },
      );
      if (result.trace_id) {
        span.setAttribute('agent.trace_id', result.trace_id);
      }
      return result;
    },
  );
}
