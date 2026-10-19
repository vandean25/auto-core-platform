import type { McpCapability } from './mcp-capabilities.service.js';
import type { McpToolName } from './mcp.constants.js';
import { MCP_WAVE2_READ_TOOL_NAMES } from './mcp-read-wave2-catalog.js';
import { MCP_WAVE2_READ_TOOL_DESCRIPTIONS } from './mcp-read-wave2-descriptions.js';

export function appendWave2ReadCapabilities(
  tools: McpCapability[],
): McpCapability[] {
  const wave2Tools: McpCapability[] = MCP_WAVE2_READ_TOOL_NAMES.map(
    (tool) => ({
      tool: tool as McpToolName,
      description: MCP_WAVE2_READ_TOOL_DESCRIPTIONS[tool],
      tier: 'AUTO',
      access: 'read',
      enabled: true,
    }),
  );
  return [...tools, ...wave2Tools];
}
