import {
  MCP_WRITE_TOOL_NAMES,
  type McpToolName,
  type McpWriteToolName,
} from './mcp.constants.js';
import { mcpWriteToolInputSchemas } from './mcp-tool-schemas.write.js';
import type { z } from 'zod';

type McpRegisterToolInputSchema = z.ZodTypeAny | Record<string, z.ZodTypeAny>;

export function writeToolInputShape(
  toolName: McpWriteToolName,
): McpRegisterToolInputSchema {
  const schema = mcpWriteToolInputSchemas[toolName] as z.ZodObject<
    Record<string, z.ZodTypeAny>
  >;
  return schema.shape;
}

export function withWriteToolInputShapes<
  T extends Record<McpToolName, McpRegisterToolInputSchema>,
>(registered: T): T {
  const next = { ...registered };
  for (const toolName of MCP_WRITE_TOOL_NAMES) {
    next[toolName] = writeToolInputShape(toolName);
  }
  return next;
}
