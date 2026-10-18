import type { McpToolName } from './mcp.constants.js';
import { MCP_TOOL_DESCRIPTIONS as coreDescriptions } from './mcp-tool-descriptions.js';
import { MCP_WRITE_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.write.js';

export const MCP_TOOL_DESCRIPTIONS: Record<McpToolName, string> = {
  ...coreDescriptions,
  ...MCP_WRITE_TOOL_DESCRIPTIONS,
};
