import { AgentPolicyTier } from '@prisma/client';
import type { McpWriteToolName } from './mcp.constants.js';
import { MCP_WRITE_TIER_PROPOSE_CLAMP_TOOLS } from './mcp-write-tier-clamp.js';

/**
 * Server-side tier clamp for MCP writes. propose_line_item never executes on
 * its own, so an AUTO policy result is held at PROPOSE. Shared by the write
 * pipeline and get_capabilities so both report the same tier.
 */
export function effectiveMcpWriteTier(
  toolName: McpWriteToolName,
  tier: AgentPolicyTier,
): AgentPolicyTier {
  if (
    MCP_WRITE_TIER_PROPOSE_CLAMP_TOOLS.has(toolName) &&
    tier === AgentPolicyTier.AUTO
  ) {
    return AgentPolicyTier.PROPOSE;
  }
  return tier;
}
