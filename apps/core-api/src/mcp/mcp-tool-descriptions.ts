import type { McpToolName } from './mcp.constants.js';

export const MCP_TOOL_DESCRIPTIONS: Record<McpToolName, string> = {
  search_customers: 'Search customers (tenant-scoped, paged)',
  get_customer: 'Get a customer by id',
  search_vehicles: 'Search vehicles (tenant-scoped, paged)',
  get_vehicle: 'Get a vehicle by id',
  list_workshop_orders: 'List workshop orders for the active site (paged)',
  get_workshop_order: 'Get a workshop order by id (active site)',
  search_parts:
    'Search parts by query; optional workshop_order_id uses workshop catalog context',
  get_stock_level: 'Stock levels for a catalog item id or SKU (active site)',
  get_vehicle_stock_age_report:
    'Read paged dealer stock age and cost basis for the active site',
  get_vehicle_stock_margin_report:
    'Read paged invoiced vehicle margins for the active site and date period',
  list_bays: 'List active bays for the active site (paged)',
  list_bins: 'List bin storage locations for the active site (paged)',
  list_workshop_tasks:
    'List workshop tasks the caller may see, including line IDs (paged)',
  whoami:
    'Caller identity, role, tenant, active site, and decision apply mode (no input)',
  get_capabilities:
    'Paged tools the caller may use, with policy tier, enabled state, and disabled reason',
  draft_workshop_order:
    'Create a DRAFT/SCHEDULED workshop order (policy-checked, logged)',
  reserve_part:
    'Reserve a catalog part line from a bin; AUTO at or below policy amount_max (EUR 250 platform cap), PROPOSE above amount_max (reversible; counter-tool: release_reservation)',
  release_reservation:
    'Release a parts reservation (counter-tool of reserve_part)',
  propose_line_item:
    'Propose a workshop task line item (never executes; records a pending proposal)',
};
