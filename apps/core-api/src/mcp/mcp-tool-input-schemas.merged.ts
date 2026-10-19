import type { z } from 'zod';
import { mcpToolInputSchemas as coreMcpToolInputSchemas } from './mcp-tool-schemas.js';
import { mcpComplianceReadInputSchemas } from './mcp-tool-schemas.compliance-reads.js';
import { mcpWave2ReadInputSchemas } from './mcp-tool-schemas.aut615-reads.js';
import type { McpReadToolNameWithWave2 } from './mcp-read-tool-catalog.aut615.js';

/** Input schemas for every read tool, including AUT-605/615 extension reads. */
export const mcpToolInputSchemas = {
  ...coreMcpToolInputSchemas,
  ...mcpComplianceReadInputSchemas,
  ...mcpWave2ReadInputSchemas,
} as Record<McpReadToolNameWithWave2, z.ZodTypeAny>;
