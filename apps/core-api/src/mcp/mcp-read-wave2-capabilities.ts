import type { McpCapability } from './mcp-capabilities.service.js';
import type { McpToolName } from './mcp.constants.js';
import { isMcpSupervisorRole } from './mcp.authorization.js';
import { MCP_WAVE2_READ_TOOL_NAMES } from './mcp-read-wave2-catalog.js';
import { MCP_WAVE2_READ_TOOL_DESCRIPTIONS } from './mcp-read-wave2-descriptions.js';

const STAFF_AVAILABILITY_TOOL = 'get_staff_availability' as const;

export function appendWave2ReadCapabilities(
  tools: McpCapability[],
  role: string | null | undefined,
): McpCapability[] {
  const isSupervisor = isMcpSupervisorRole(role);
  const wave2Tools: McpCapability[] = MCP_WAVE2_READ_TOOL_NAMES.map((tool) => {
    const entry = {
      tool: tool as McpToolName,
      description: MCP_WAVE2_READ_TOOL_DESCRIPTIONS[tool],
      tier: 'AUTO' as const,
      access: 'read' as const,
    };
    if (tool === STAFF_AVAILABILITY_TOOL && !isSupervisor) {
      return {
        ...entry,
        enabled: false,
        disabled_reason: 'role_not_permitted',
      };
    }
    return { ...entry, enabled: true };
  });
  return [...tools, ...wave2Tools];
}
