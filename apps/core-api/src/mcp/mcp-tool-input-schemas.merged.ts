import type { z } from 'zod';
import { mcpToolInputSchemas as coreMcpToolInputSchemas } from './mcp-tool-schemas.js';
import { mcpComplianceReadInputSchemas } from './mcp-tool-schemas.compliance-reads.js';
import type { McpReadToolNameWithCompliance } from './mcp-read-tool-catalog.aut605.js';

/** Input schemas for every read tool, including AUT-605 compliance reads. */
export const mcpToolInputSchemas = {
  ...coreMcpToolInputSchemas,
  ...mcpComplianceReadInputSchemas,
} as Record<McpReadToolNameWithCompliance, z.ZodTypeAny>;
