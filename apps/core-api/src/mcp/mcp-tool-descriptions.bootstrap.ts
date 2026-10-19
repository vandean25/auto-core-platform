import { MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import { MCP_TOOL_DESCRIPTIONS_PUBLISHED } from './mcp-tool-descriptions.published.js';

/** Nest MCP module entry: apply published write-tool dry_run hints for servers that import the base map. */
export function bootstrapMcpToolDescriptionsWithDryRun(): void {
  for (const toolName of MCP_WRITE_TOOL_NAMES) {
    MCP_TOOL_DESCRIPTIONS[toolName] =
      MCP_TOOL_DESCRIPTIONS_PUBLISHED[toolName];
  }
}

bootstrapMcpToolDescriptionsWithDryRun();
