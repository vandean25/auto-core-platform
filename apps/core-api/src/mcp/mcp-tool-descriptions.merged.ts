import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import { MCP_COMPLIANCE_READ_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.compliance-reads.js';
import { MCP_WAVE2_READ_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.aut615-reads.js';
import type { McpToolNameWithWave2 } from './mcp-read-tool-catalog.aut615.js';

export const MCP_TOOL_DESCRIPTIONS_WITH_WAVE2: Record<
  McpToolNameWithWave2,
  string
> = {
  ...MCP_TOOL_DESCRIPTIONS,
  ...MCP_COMPLIANCE_READ_TOOL_DESCRIPTIONS,
  ...MCP_WAVE2_READ_TOOL_DESCRIPTIONS,
};

/** @deprecated Use {@link MCP_TOOL_DESCRIPTIONS_WITH_WAVE2}. */
export const MCP_TOOL_DESCRIPTIONS_WITH_COMPLIANCE =
  MCP_TOOL_DESCRIPTIONS_WITH_WAVE2;
