import { mcpToolOutputSchemas as coreMcpToolOutputSchemas } from './mcp-tool-output-schemas.js';
import {
  getCapabilitiesOutputSchemaWithCompliance,
  mcpComplianceReadOutputSchemas,
} from './mcp-tool-output-schemas.compliance-reads.js';
import { getCapabilitiesOutputSchemaWithWave2 } from './mcp-capabilities-output.aut615.js';
import { mcpWave2ReadOutputSchemas } from './mcp-tool-output-schemas.aut615-reads.js';
import type { McpToolNameWithWave2 } from './mcp-read-tool-catalog.aut615.js';
import type { z } from 'zod';

export const mcpToolOutputSchemas = {
  ...coreMcpToolOutputSchemas,
  ...mcpComplianceReadOutputSchemas,
  ...mcpWave2ReadOutputSchemas,
  get_capabilities: getCapabilitiesOutputSchemaWithWave2,
} as Record<McpToolNameWithWave2, z.ZodTypeAny>;

export type McpToolOutputSchemas = typeof mcpToolOutputSchemas;
