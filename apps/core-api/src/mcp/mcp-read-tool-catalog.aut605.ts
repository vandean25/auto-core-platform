import {
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
} from './mcp.constants.js';

/** AUT-605 read tools (kept out of {@link MCP_READ_TOOL_NAMES} for repowise). */
export const MCP_COMPLIANCE_READ_TOOL_NAMES = [
  'check_contact_permission',
  'list_gewaehrleistung_due',
  'list_tyre_sets',
  'list_warranty_claims',
] as const;

export type McpComplianceReadToolName =
  (typeof MCP_COMPLIANCE_READ_TOOL_NAMES)[number];

export const MCP_READ_TOOL_NAMES_WITH_COMPLIANCE = [
  ...MCP_READ_TOOL_NAMES,
  ...MCP_COMPLIANCE_READ_TOOL_NAMES,
] as const;

export type McpReadToolNameWithCompliance =
  (typeof MCP_READ_TOOL_NAMES_WITH_COMPLIANCE)[number];

export const MCP_TOOL_NAMES_WITH_COMPLIANCE = [
  ...MCP_READ_TOOL_NAMES_WITH_COMPLIANCE,
  ...MCP_WRITE_TOOL_NAMES,
] as const;

export type McpToolNameWithCompliance =
  (typeof MCP_TOOL_NAMES_WITH_COMPLIANCE)[number];

const complianceReadToolSet = new Set<string>(MCP_COMPLIANCE_READ_TOOL_NAMES);

export function isMcpComplianceReadToolName(
  toolName: string,
): toolName is McpComplianceReadToolName {
  return complianceReadToolSet.has(toolName);
}
