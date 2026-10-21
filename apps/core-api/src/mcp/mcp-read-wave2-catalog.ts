import { MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';
import { MCP_READ_TOOL_NAMES_WITH_COMPLIANCE } from './mcp-read-tool-catalog.aut605.js';

/** AUT-615 read tools (kept out of core constants for repowise). */
export const MCP_WAVE2_READ_TOOL_NAMES = [
  'list_loaner_bookings',
  'list_estimates',
  'list_order_communications',
  'get_check_in',
  'get_staff_availability',
] as const;

export type McpWave2ReadToolName = (typeof MCP_WAVE2_READ_TOOL_NAMES)[number];

export const MCP_READ_TOOL_NAMES_WITH_WAVE2 = [
  ...MCP_READ_TOOL_NAMES_WITH_COMPLIANCE,
  ...MCP_WAVE2_READ_TOOL_NAMES,
] as const;

export const MCP_TOOL_NAMES_WITH_WAVE2 = [
  ...MCP_READ_TOOL_NAMES_WITH_WAVE2,
  ...MCP_WRITE_TOOL_NAMES,
] as const;

export type McpToolNameWithWave2 = (typeof MCP_TOOL_NAMES_WITH_WAVE2)[number];

const wave2ReadToolSet = new Set<string>(MCP_WAVE2_READ_TOOL_NAMES);

export function isMcpWave2ReadToolName(
  toolName: string,
): toolName is McpWave2ReadToolName {
  return wave2ReadToolSet.has(toolName);
}
