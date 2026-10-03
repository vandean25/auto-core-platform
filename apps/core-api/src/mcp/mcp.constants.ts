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
