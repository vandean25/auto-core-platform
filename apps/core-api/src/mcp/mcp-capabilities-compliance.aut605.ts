import type { McpCapability } from './mcp-capabilities.service.js';
import type { McpToolName } from './mcp.constants.js';
import { MCP_COMPLIANCE_READ_TOOL_NAMES } from './mcp-read-tool-catalog.aut605.js';
import { MCP_COMPLIANCE_READ_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.compliance-reads.js';

/** Appends AUT-605 read tools to a capabilities page without editing mcp-capabilities.service.ts. */
export function appendComplianceReadCapabilities(
  tools: McpCapability[],
): McpCapability[] {
  const complianceTools: McpCapability[] = MCP_COMPLIANCE_READ_TOOL_NAMES.map(
    (tool) => ({
      tool: tool as McpToolName,
      description: MCP_COMPLIANCE_READ_TOOL_DESCRIPTIONS[tool],
      tier: 'AUTO',
      access: 'read',
      enabled: true,
    }),
  );
  return [...tools, ...complianceTools];
}
