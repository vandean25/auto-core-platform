import { MCP_WRITE_TOOL_NAMES, type McpToolName } from './mcp.constants.js';
import { mcpWriteToolInputSchemas } from './mcp-tool-schemas.js';
import type { z } from 'zod';

type McpRegisterToolInputSchema = z.ZodTypeAny | Record<string, z.ZodTypeAny>;

/** Registers strict write-tool Zod objects (including optional dry_run), not loose shapes. */
export function withWriteToolInputSchemas<
  T extends Record<McpToolName, McpRegisterToolInputSchema>,
>(registered: T): T {
  const next = { ...registered };
  for (const toolName of MCP_WRITE_TOOL_NAMES) {
    next[toolName] = mcpWriteToolInputSchemas[toolName];
  }
  return next;
}

/** @deprecated Use {@link withWriteToolInputSchemas}. */
export const withWriteToolInputShapes = withWriteToolInputSchemas;
