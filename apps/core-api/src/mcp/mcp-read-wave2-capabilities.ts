import {
  isMcpToolAllowed,
  legacyAccessOfRole,
} from '../permissions/permission-resolver.js';
import type { McpCapability } from './mcp-capabilities.service.js';
import { MCP_WAVE2_READ_TOOL_NAMES } from './mcp-read-wave2-catalog.js';
import { MCP_WAVE2_READ_TOOL_DESCRIPTIONS } from './mcp-read-wave2-descriptions.js';

/** The permission entry of each tool decides the listing, so the catalog matches what a call accepts. */
export function appendWave2ReadCapabilities(
  tools: McpCapability[],
  role: string | null | undefined,
): McpCapability[] {
  const access = legacyAccessOfRole(role);
  const wave2Tools: McpCapability[] = MCP_WAVE2_READ_TOOL_NAMES.map((tool) => {
    const entry: McpCapability = {
      tool,
      description: MCP_WAVE2_READ_TOOL_DESCRIPTIONS[tool],
      tier: 'AUTO',
      access: 'read',
      enabled: isMcpToolAllowed(tool, access),
    };
    return entry.enabled
      ? entry
      : { ...entry, disabled_reason: 'role_not_permitted' };
  });
  return [...tools, ...wave2Tools];
}
