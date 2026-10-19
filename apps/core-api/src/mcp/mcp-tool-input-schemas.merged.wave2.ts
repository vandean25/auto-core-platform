import type { z } from 'zod';
import { mcpToolInputSchemas as complianceMergedSchemas } from './mcp-tool-input-schemas.merged.js';
import { mcpWave2ReadInputSchemas } from './mcp-read-wave2-schemas.js';
import type { McpReadToolNameWithWave2 } from './mcp-read-wave2-catalog.js';

export const mcpToolInputSchemasWithWave2 = {
  ...complianceMergedSchemas,
  ...mcpWave2ReadInputSchemas,
} as Record<McpReadToolNameWithWave2, z.ZodTypeAny>;
