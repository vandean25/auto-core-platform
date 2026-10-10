import type { McpToolName } from './mcp.constants.js';

export const MCP_TOOL_DESCRIPTIONS: Record<McpToolName, string> = {
  search_customers: 'Search customers (tenant-scoped, paged)',
  get_customer:
    'Get a customer by id: contact data, vehicles, and a compact order history (orders newest first, max 25 per page, paged with orders_cursor; invoices via list_invoices)',
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
  list_invoices:
    'List invoices for the active site by status, customer, order, issue date, or number (keyset cursor, newest first)',
  get_invoice:
    'Get an invoice for the active site: lines, net/tax/gross totals, seller as printed on the PDF, order links, and credit notes',
  list_bays: 'List active bays for the active site (paged)',
  list_bins: 'List bin storage locations for the active site (paged)',
  list_workshop_tasks:
    'List workshop tasks the caller may see, including line IDs (paged)',
  whoami:
    'Caller identity, role, tenant, active site, and decision apply mode (no input)',
  get_capabilities:
    'Paged tools the caller may use, with policy tier, enabled state, and disabled reason',
  list_audit_events:
    'Tenant audit events, newest first, filtered by entity, actor, action, date range, or trace ID (paged; OWNER and ADMIN only)',
  get_entity_history:
    'Field changes for one entity, newest first, with email, phone, and address values masked (paged; OWNER and ADMIN only)',
  get_agent_action:
    'Agent action log rows and correlated audit entries for a trace ID (paged; OWNER and ADMIN only)',
  list_agent_actions:
    'Agent action log rows filtered by agent, tool, tier, status, or time range (paged; OWNER and ADMIN only)',
  get_vehicle_history:
    'Vehicle history for the active site: compact orders (paged with orders_cursor), Pickerl status with recent inspections, and the first page of documents (list_documents for more)',
  list_documents:
    'List stored PDFs for the active site (invoice, credit_note, workshop_order, vehicle_sale_contract), filtered by type, customer, vehicle, or owner record; newest first (keyset cursor, max 25)',
  get_document_pdf:
    'Metadata and a read link for one stored PDF by document ID (<type>:<uuid>). The link expires within 15 minutes; PDF bytes are never returned',
  draft_workshop_order:
    'Create a DRAFT/SCHEDULED workshop order (policy-checked, logged)',
  reserve_part:
    'Reserve a catalog part line from a bin; AUTO at or below policy amount_max (EUR 250 platform cap), PROPOSE above amount_max (reversible; counter-tool: release_reservation)',
  release_reservation:
    'Release a parts reservation (counter-tool of reserve_part)',
  propose_line_item:
    'Propose a workshop task line item (never executes; records a pending proposal)',
};
