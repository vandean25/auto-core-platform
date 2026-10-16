import { MCP_REGISTERED_TOOL_INPUT_SCHEMAS } from './mcp-server.factory.js';

/** MCP read tools whose input exposes a top-level page size (AUT-429). */
const MCP_PAGING_TOOL_NAMES = [
  'search_customers',
  'search_vehicles',
  'list_workshop_orders',
  'search_parts',
  'list_bays',
  'list_bins',
  'list_workshop_tasks',
  'get_capabilities',
  'list_sites',
  'list_audit_events',
  'get_entity_history',
  'get_agent_action',
  'list_agent_actions',
  'list_invoices',
  'list_documents',
  'list_purchase_orders',
  'list_vendors',
  'list_catalog_items',
  'list_price_lists',
  'list_margin_rules',
  'get_vehicle_stock_age_report',
  'get_vehicle_stock_margin_report',
  'list_pickerl_due',
  'list_workshop_slots',
  'list_available_loaners',
  'get_vehicle_context',
] as const;

function inputSchemaProperties(
  toolName: (typeof MCP_PAGING_TOOL_NAMES)[number],
): Record<string, unknown> {
  const schema = MCP_REGISTERED_TOOL_INPUT_SCHEMAS[toolName];
  if (schema && typeof schema === 'object' && !('parse' in schema)) {
    return schema as Record<string, unknown>;
  }
  throw new Error(`Expected a shape object for ${toolName}`);
}

describe('MCP paging input contract (AUT-429)', () => {
  it('advertises pageSize and not page_size on every paging tool', () => {
    for (const toolName of MCP_PAGING_TOOL_NAMES) {
      const properties = inputSchemaProperties(toolName);
      expect(properties).toHaveProperty('pageSize');
      expect(properties).not.toHaveProperty('page_size');
    }
  });
});
