import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import { MCP_COMPLIANCE_READ_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.compliance-reads.js';
export const MCP_TOOL_DESCRIPTIONS_WITH_COMPLIANCE: Record<
  McpToolNameWithCompliance,
  string
> = {
  ...MCP_TOOL_DESCRIPTIONS,
  ...MCP_COMPLIANCE_READ_TOOL_DESCRIPTIONS,
};
