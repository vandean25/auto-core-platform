import { z } from 'zod';
import { MCP_TOOL_NAMES_WITH_WAVE2 } from './mcp-read-tool-catalog.aut615.js';

const capabilityRow = z.object({
  tool: z.enum(MCP_TOOL_NAMES_WITH_WAVE2),
  description: z.string(),
  tier: z.enum(['AUTO', 'PROPOSE']),
  access: z.enum(['read', 'write']),
  enabled: z.boolean(),
  disabled_reason: z.enum(['policy_disabled', 'role_not_permitted']).optional(),
});

export const getCapabilitiesOutputSchemaWithWave2 = z.object({
  data: z.array(capabilityRow),
  meta: z.object({
    total: z.number().int(),
    page_size: z.number().int(),
    next_cursor: z.string().nullable(),
  }),
  human_only_actions: z.array(z.string()),
});
