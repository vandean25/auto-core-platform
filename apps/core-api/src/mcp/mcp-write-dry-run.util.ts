import { AgentPolicyTier } from '@prisma/client';
import type { McpWriteToolName } from './mcp.constants.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import { extractMcpWriteDryRunWarnings } from './mcp-write-dry-run.schema.js';

export type McpWritePolicyDecisionTier = 'AUTO' | 'PROPOSE' | 'HUMAN_ONLY';

export type McpWritePolicyDecision = {
  tier: McpWritePolicyDecisionTier;
  reasons: string[];
};

export type McpWriteDryRunResult = {
  dry_run: true;
  tool: McpWriteToolName;
  tier: AgentPolicyTier;
  would_change: WouldChangeItem[];
  preview: unknown;
  policy_decision: McpWritePolicyDecision;
  warnings: string[];
  trace_id?: string;
};

export function toMcpWritePolicyDecision(
  tier: AgentPolicyTier,
  reasons: string[],
): McpWritePolicyDecision {
  if (tier === AgentPolicyTier.AUTO || tier === AgentPolicyTier.PROPOSE) {
    return { tier, reasons };
  }
  return { tier: 'HUMAN_ONLY', reasons };
}

export function buildMcpWriteDryRunResult(input: {
  tool: McpWriteToolName;
  tier: AgentPolicyTier;
  reasons: string[];
  would_change: WouldChangeItem[];
  preview: unknown;
  trace_id?: string;
}): McpWriteDryRunResult {
  const policy_decision = toMcpWritePolicyDecision(input.tier, input.reasons);
  return {
    dry_run: true,
    tool: input.tool,
    tier: input.tier,
    would_change:
      policy_decision.tier === 'HUMAN_ONLY' ? [] : input.would_change,
    preview: policy_decision.tier === 'HUMAN_ONLY' ? null : input.preview,
    policy_decision,
    warnings: extractMcpWriteDryRunWarnings(input.preview),
    ...(input.trace_id ? { trace_id: input.trace_id } : {}),
  };
}
