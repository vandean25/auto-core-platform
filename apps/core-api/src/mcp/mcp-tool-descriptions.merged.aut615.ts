import { MCP_TOOL_DESCRIPTIONS_WITH_COMPLIANCE } from './mcp-tool-descriptions.merged.js';
import { MCP_WAVE2_READ_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.aut615-reads.js';
import type { McpToolNameWithWave2 } from './mcp-read-tool-catalog.aut615.js';

export const MCP_TOOL_DESCRIPTIONS_WITH_WAVE2: Record<
  McpToolNameWithWave2,
  string
> = {
  ...MCP_TOOL_DESCRIPTIONS_WITH_COMPLIANCE,
  ...MCP_WAVE2_READ_TOOL_DESCRIPTIONS,
};
