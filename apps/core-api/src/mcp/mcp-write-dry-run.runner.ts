import { AgentPolicyTier } from '@prisma/client';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { McpWriteToolName } from './mcp.constants.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import {
  buildMcpWriteDryRunResult,
  type McpWriteDryRunResult,
} from './mcp-write-dry-run.util.js';

export type McpWriteDryRunCall = {
  toolName: McpWriteToolName;
  actionType: string;
  tier: AgentPolicyTier;
  reasons: string[];
  inputSummary: { tool: McpWriteToolName; args: unknown };
  context: {
    agentId: string;
    onBehalfOfUserId: string;
  };
};

export type McpWriteDryRunSimulation = {
  preview: unknown;
  wouldChange: WouldChangeItem[];
};

export async function resolveMcpWriteDryRunSimulation(
  tier: AgentPolicyTier,
  simulate: () => Promise<McpWriteDryRunSimulation>,
): Promise<McpWriteDryRunSimulation> {
  if (tier === AgentPolicyTier.HUMAN_ONLY) {
    return { preview: null, wouldChange: [] };
  }
  return simulate();
}

export async function executeMcpWriteDryRun(
  agentActionLog: AgentActionLogService,
  call: McpWriteDryRunCall,
  simulation: McpWriteDryRunSimulation,
  recordFailure: (error: unknown) => Promise<void>,
): Promise<McpWriteDryRunResult> {
  const dryRunResult = buildMcpWriteDryRunResult({
    tool: call.toolName,
    tier: call.tier,
    reasons: call.reasons,
    would_change: simulation.wouldChange,
    preview: simulation.preview,
  });
  try {
    const record = await agentActionLog.record({
      actorType: 'AGENT',
      agentId: call.context.agentId,
      onBehalfOfUserId: call.context.onBehalfOfUserId,
      actionType: call.actionType,
      tier: call.tier,
      status: 'DRY_RUN',
      inputSummary: call.inputSummary,
      resultSummary: {
        dry_run: true,
        policy_decision: dryRunResult.policy_decision,
      },
    });
    return { ...dryRunResult, trace_id: record.traceId };
  } catch (error) {
    await recordFailure(error);
    throw error;
  }
}
