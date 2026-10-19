import { MCP_TOOL_DESCRIPTIONS_WITH_COMPLIANCE } from './mcp-tool-descriptions.merged.js';
import { MCP_WAVE2_READ_TOOL_DESCRIPTIONS } from './mcp-read-wave2-descriptions.js';
import type { McpToolNameWithWave2 } from './mcp-read-wave2-catalog.js';

export const MCP_TOOL_DESCRIPTIONS_WITH_WAVE2: Record<
  McpToolNameWithWave2,
  string
> = {
  ...MCP_TOOL_DESCRIPTIONS_WITH_COMPLIANCE,
  ...MCP_WAVE2_READ_TOOL_DESCRIPTIONS,
};
