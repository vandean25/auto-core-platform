import { mcpToolOutputSchemas as coreMcpToolOutputSchemas } from './mcp-tool-output-schemas.js';
import {
  getCapabilitiesOutputSchemaWithCompliance,
  mcpComplianceReadOutputSchemas,
} from './mcp-tool-output-schemas.compliance-reads.js';
import type { McpToolNameWithCompliance } from './mcp-read-tool-catalog.aut605.js';
import type { z } from 'zod';

export const mcpToolOutputSchemas = {
  ...coreMcpToolOutputSchemas,
  ...mcpComplianceReadOutputSchemas,
  get_capabilities: getCapabilitiesOutputSchemaWithCompliance,
} as Record<McpToolNameWithCompliance, z.ZodTypeAny>;

export type McpToolOutputSchemas = typeof mcpToolOutputSchemas;
