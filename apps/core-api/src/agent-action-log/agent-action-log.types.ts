import { z } from 'zod';

export const AGENT_ACTION_TIERS = ['AUTO', 'PROPOSE', 'HUMAN_ONLY'] as const;

export const AGENT_ACTION_STATUSES = [
  'PROPOSED',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'FAILED',
  'DRY_RUN',
] as const;

export type AgentActionTier = (typeof AGENT_ACTION_TIERS)[number];
export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

const tierSchema = z.enum(AGENT_ACTION_TIERS);
const statusSchema = z.enum(AGENT_ACTION_STATUSES);

export const agentActionRecordInputSchema = z.object({
  traceId: z.string().uuid().optional(),
  parentTraceId: z.string().uuid().optional(),
  actorType: z.enum(['AGENT', 'USER', 'SYSTEM']),
  agentId: z.string().min(1).optional(),
  onBehalfOfUserId: z.string().optional(),
  actionType: z.string().min(1),
  tier: tierSchema,
  status: statusSchema,
  inputSummary: z.unknown().optional(),
  resultSummary: z.unknown().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  reversible: z.boolean().optional(),
  revertedByLogId: z.string().optional(),
});

export type AgentActionRecordInput = z.infer<
  typeof agentActionRecordInputSchema
>;
