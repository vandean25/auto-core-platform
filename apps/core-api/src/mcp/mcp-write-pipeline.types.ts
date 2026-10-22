import type { AgentPolicyTier } from '@prisma/client';
import type { AgentActionRecordInput } from '../agent-action-log/agent-action-log.types.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import type { CustomerProposalResultFields } from './mcp-write-customer-result.js';
import type { McpWriteToolName } from './mcp.constants.js';

export type McpWriteToolContext = {
  agentId: string;
  onBehalfOfUserId: string;
};

export type McpWriteExecution = {
  toolName: McpWriteToolName;
  policyActionType: string;
  buildPolicyContext: (
    input: unknown,
  ) => AgentPolicyEvaluateContext | Promise<AgentPolicyEvaluateContext>;
  buildExecutionContext?: (input: unknown) => Promise<Record<string, unknown>>;
  execute: (
    input: unknown,
    executionContext?: Record<string, unknown>,
  ) => Promise<unknown>;
  buildResultSummary: (result: unknown) => unknown;
  buildLogMetadata?: (
    result: unknown,
  ) => Pick<AgentActionRecordInput, 'entityType' | 'entityId' | 'reversible'>;
  preview?: (
    input: unknown,
    executionContext?: Record<string, unknown>,
  ) => Promise<unknown>;
  executeOutsideTransaction?: boolean;
  refreshReplayResult?: (
    result: McpWriteToolResult,
  ) => Promise<McpWriteToolResult>;
};

export type McpWriteToolResult = {
  tool: McpWriteToolName;
  tier: AgentPolicyTier;
  status: 'executed' | 'needs_approval';
  would_change: WouldChangeItem[];
  result?: unknown;
  proposal?: unknown;
  pending_action_id?: string;
  trace_id?: string;
  replayed?: boolean;
} & CustomerProposalResultFields;

export type McpWriteCall = {
  execution: McpWriteExecution;
  input: unknown;
  context: McpWriteToolContext;
  actionType: string;
  inputSummary: { tool: McpWriteToolName; args: unknown };
  tier: AgentPolicyTier;
  reasons: string[];
};

export type McpWriteSimulation = {
  preview: unknown;
  wouldChange: WouldChangeItem[];
  executionContext?: Record<string, unknown>;
};
