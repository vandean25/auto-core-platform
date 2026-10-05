export const MCP_SERVER_IMPLEMENTATION = {
  name: 'auto-core-platform-mcp',
  version: '1.0.0',
} as const;

export const MCP_DEFAULT_PAGE = 1;
export const MCP_DEFAULT_PAGE_SIZE = 10;
export const MCP_MAX_PAGE_SIZE = 25;

/** Max serialized tool result bytes returned to the MCP client. */
export const MCP_TOOL_RESULT_MAX_BYTES = 32_768;

export const MCP_MAX_OPEN_SESSIONS = 200;

export const MCP_ACTION_PREFIX = 'mcp';

export const MCP_READ_TOOL_NAMES = [
  'search_customers',
  'get_customer',
  'search_vehicles',
  'get_vehicle',
  'list_workshop_orders',
  'get_workshop_order',
  'search_parts',
  'get_stock_level',
] as const;

export type McpReadToolName = (typeof MCP_READ_TOOL_NAMES)[number];

export const MCP_WRITE_TOOL_NAMES = [
  'draft_workshop_order',
  'reserve_part',
  'release_reservation',
  'propose_line_item',
] as const;

export type McpWriteToolName = (typeof MCP_WRITE_TOOL_NAMES)[number];

export const MCP_TOOL_NAMES = [
  ...MCP_READ_TOOL_NAMES,
  ...MCP_WRITE_TOOL_NAMES,
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/**
 * Capabilities that must never be exposed as MCP tools. Each value mirrors a
 * policy action type (or category) that the agent policy floor already keeps
 * HUMAN_ONLY or that is intentionally withheld from agent automation.
 */
export const MCP_NEVER_EXPOSED_ACTIONS = [
  'invoice.finalize',
  'credit_note.issue',
  'credit_note.finalize',
  'accounting_export.create',
  'accounting_export.submit',
  'customer.delete',
  'vehicle.delete',
  'workshop_order.delete',
  'tenant_member.role_change',
  'tenant_member.invite',
  'consent.update',
  'consent.revoke',
  'estimate.send_customer_message',
] as const;
