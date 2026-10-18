import { AgentPolicyTier } from '@prisma/client';
import { agentPolicyOutcome } from '../agent-policy/agent-policy.evaluator.js';
import { withSpan } from '../common/observability/trace.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import {
  executeMcpWriteDryRun,
  resolveMcpWriteDryRunSimulation,
} from './mcp-write-dry-run.runner.js';
import type { McpWriteDryRunResult } from './mcp-write-dry-run.util.js';
import type {
  McpWriteCall,
  McpWriteExecution,
  McpWriteSimulation,
  McpWriteToolContext,
} from './mcp-write-pipeline.types.js';

export async function runMcpWriteDryRunPath(input: {
  execution: McpWriteExecution;
  workInput: unknown;
  context: McpWriteToolContext;
  loggedInput: unknown;
  normalizeWriteInput: (
    execution: McpWriteExecution,
    value: unknown,
  ) => Promise<unknown>;
  evaluatePolicy: (call: McpWriteCall) => Promise<void>;
  simulate: (call: McpWriteCall) => Promise<McpWriteSimulation>;
  recordFailure: (call: McpWriteCall, error: unknown) => Promise<void>;
  agentActionLog: AgentActionLogService;
  logActionType: (toolName: McpWriteExecution['toolName']) => string;
}): Promise<McpWriteDryRunResult> {
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
      await input.evaluatePolicy(call);
      span.setAttribute('agent.policy.tier', call.tier);

      const result = await withSpan(
        'Agent decision',
        'agent.decision',
        { 'agent.policy.outcome': agentPolicyOutcome(call.tier) },
        async () => {
          const simulation = await resolveMcpWriteDryRunSimulation(
            call.tier,
            () => input.simulate(call),
          );
          return executeMcpWriteDryRun(
            input.agentActionLog,
            {
              toolName: call.execution.toolName,
              actionType: call.actionType,
              tier: call.tier,
              reasons: call.reasons,
              inputSummary: call.inputSummary,
              context: call.context,
            },
            simulation,
            (error) => input.recordFailure(call, error),
          );
        },
      );
      if (result.trace_id) {
        span.setAttribute('agent.trace_id', result.trace_id);
      }
      return result;
    },
  );
}
