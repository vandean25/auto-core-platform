import type { McpToolName } from './mcp.constants.js';
import { MCP_TOOL_DESCRIPTIONS as MCP_TOOL_DESCRIPTIONS_BASE } from './mcp-tool-descriptions.js';
import { MCP_WRITE_TOOL_DESCRIPTIONS_WITH_DRY_RUN } from './mcp-tool-descriptions.write.js';

export const MCP_TOOL_DESCRIPTIONS_PUBLISHED: Record<McpToolName, string> = {
  ...MCP_TOOL_DESCRIPTIONS_BASE,
  ...MCP_WRITE_TOOL_DESCRIPTIONS_WITH_DRY_RUN,
};
