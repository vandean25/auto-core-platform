import type { McpWriteToolName } from './mcp.constants.js';

/** Write tools that are always held at PROPOSE even when policy says AUTO. */
export const MCP_WRITE_TIER_PROPOSE_CLAMP_TOOLS: ReadonlySet<McpWriteToolName> =
  new Set([
    'propose_line_item',
    'propose_registration_intake',
    'propose_workshop_booking',
    'propose_purchase_order',
    'propose_workshop_order_completion',
    'propose_invoice_draft_from_order',
    'propose_mechanic_finding',
  ]);
