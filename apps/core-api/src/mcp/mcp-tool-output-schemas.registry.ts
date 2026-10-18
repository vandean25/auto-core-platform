import { z } from 'zod';
import { type McpToolName } from './mcp.constants.js';
import { mcpToolOutputSchemas as coreMcpToolOutputSchemas } from './mcp-tool-output-schemas.js';
import { mcpWriteToolOutputSchemas } from './mcp-tool-output-schemas.write.js';

export const mcpToolOutputSchemas = {
  ...coreMcpToolOutputSchemas,
  ...mcpWriteToolOutputSchemas,
} satisfies Record<McpToolName, z.ZodType>;

export type McpToolOutputSchemas = typeof mcpToolOutputSchemas;
