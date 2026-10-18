import { z } from 'zod';
import type { McpWriteToolName } from './mcp.constants.js';

/** Shared MCP write input flag (default false when omitted). */
export const dryRunArgSchema = z
  .boolean()
  .optional()
  .describe(
    'When true, simulate policy and effects only: no write, proposal, idempotency receipt, or outbound side effects.',
  );

export const dryRunArg = {
  dry_run: dryRunArgSchema,
};

export function withMcpWriteDryRunInput<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
): z.ZodObject<z.ZodRawShape> {
  return schema.extend(dryRunArg);
}

const mcpDryRunWouldChangeItem = z.object({
  entity: z.string().min(1),
  id: z.string().min(1),
  op: z.enum(['create', 'update', 'delete']),
  provisional: z.boolean(),
});

export const mcpWritePolicyDecisionSchema = z.object({
  tier: z.enum(['AUTO', 'PROPOSE', 'HUMAN_ONLY']),
  reasons: z.array(z.string()),
});

export const mcpWriteDryRunResultSchema = z
  .object({
    dry_run: z.literal(true),
    tool: z.string().min(1),
    tier: z.enum(['AUTO', 'PROPOSE', 'HUMAN_ONLY']),
    would_change: z.array(mcpDryRunWouldChangeItem),
    preview: z.unknown(),
    policy_decision: mcpWritePolicyDecisionSchema,
    warnings: z.array(z.string()),
    trace_id: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.policy_decision.tier === 'HUMAN_ONLY' &&
      value.would_change.length > 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['would_change'],
        message: 'HUMAN_ONLY dry runs must not include would_change',
      });
    }
  });

export function mcpWriteDryRunResultForTool(tool: McpWriteToolName) {
  return z.intersection(
    mcpWriteDryRunResultSchema,
    z.object({ tool: z.literal(tool) }),
  );
}

export function mergeMcpWriteToolOutput(
  tool: McpWriteToolName,
  committedResultSchema: z.ZodTypeAny,
): z.ZodTypeAny {
  return z.union([committedResultSchema, mcpWriteDryRunResultForTool(tool)]);
}

export function extractMcpWriteDryRunWarnings(preview: unknown): string[] {
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    return [];
  }
  const warnings = (preview as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) {
    return [];
  }
  return warnings.filter((entry): entry is string => typeof entry === 'string');
}
