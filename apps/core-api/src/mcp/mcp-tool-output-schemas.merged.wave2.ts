import { mcpToolOutputSchemas as complianceMergedSchemas } from './mcp-tool-output-schemas.merged.js';
import { getCapabilitiesOutputSchemaWithWave2 } from './mcp-read-wave2-capabilities-output.js';
import { mcpWave2ReadOutputSchemas } from './mcp-read-wave2-output-schemas.js';
import type { McpToolNameWithWave2 } from './mcp-read-wave2-catalog.js';
import type { z } from 'zod';

export const mcpToolOutputSchemasWithWave2 = {
  ...complianceMergedSchemas,
  ...mcpWave2ReadOutputSchemas,
  get_capabilities: getCapabilitiesOutputSchemaWithWave2,
} as Record<McpToolNameWithWave2, z.ZodTypeAny>;
