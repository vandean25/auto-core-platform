import { z } from 'zod';

// NOT_EVALUATED marks a write rejected by schema validation before any policy
// evaluation: no policy tier applied, nothing previewed, proposed or executed.
// Expand-only: agent_action_logs.tier is plain text with no DB enum or CHECK.
export const AGENT_ACTION_TIERS = [
  'AUTO',
  'PROPOSE',
  'HUMAN_ONLY',
  'NOT_EVALUATED',
] as const;

export const AGENT_ACTION_STATUSES = [
  'PROPOSED',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'REFUSED',
  'FAILED',
  'DRY_RUN',
  'FALLBACK',
] as const;

export type AgentActionTier = (typeof AGENT_ACTION_TIERS)[number];
export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

const tierSchema = z.enum(AGENT_ACTION_TIERS);
const statusSchema = z.enum(AGENT_ACTION_STATUSES);

export const agentActionRecordInputSchema = z.object({
  traceId: z.string().uuid().optional(),
  parentTraceId: z.string().uuid().optional(),
  actorType: z.enum(['AGENT', 'USER', 'SYSTEM', 'API_KEY']),
  agentId: z.string().min(1).optional(),
  onBehalfOfUserId: z.string().optional(),
  /** TenantApiKey id; required context for actorType API_KEY. Never the secret. */
  apiKeyId: z.string().uuid().optional(),
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
