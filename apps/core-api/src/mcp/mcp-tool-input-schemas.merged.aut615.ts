import type { z } from 'zod';
import { mcpToolInputSchemas as complianceMergedSchemas } from './mcp-tool-input-schemas.merged.js';
import { mcpWave2ReadInputSchemas } from './mcp-tool-schemas.aut615-reads.js';
import type { McpReadToolNameWithWave2 } from './mcp-read-tool-catalog.aut615.js';

export const mcpToolInputSchemasWithWave2 = {
  ...complianceMergedSchemas,
  ...mcpWave2ReadInputSchemas,
} as Record<McpReadToolNameWithWave2, z.ZodTypeAny>;
