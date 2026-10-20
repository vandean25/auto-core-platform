import type { McpToolName } from './mcp.constants.js';

export const MCP_TOOL_DESCRIPTIONS: Record<McpToolName, string> = {
  search_customers: 'Search customers (tenant-scoped, paged)',
  get_customer:
    'Get a customer by id: contact data, vehicles, and a compact order history (orders newest first, max 25 per page, paged with orders_cursor; invoices via list_invoices)',
  search_vehicles: 'Search vehicles (tenant-scoped, paged)',
  get_vehicle: 'Get a vehicle by id',
  get_vehicle_listing_status:
    'Per-portal marketplace listing status for a vehicle at the active site (desired, export, and remote state)',
  list_workshop_orders:
    'List workshop orders for the active site by order status, current estimate status, scheduled date, or estimate sent date (site-local YYYY-MM-DD), with optional search and customer_id (paged, pageSize max 25)',
  get_workshop_order: 'Get a workshop order by id (active site)',
  search_parts:
    'Search parts by query; optional workshop_order_id uses workshop catalog context',
  get_stock_level: 'Stock levels for a catalog item id or SKU (active site)',
  get_vehicle_stock_age_report:
    'Paged dealer stock age and cost basis for the active site or a given site (site_id); optional from/to stock-in window; pageSize max 25 with opaque cursor',
  get_vehicle_stock_margin_report:
    'Paged invoiced vehicle margins by invoice date for the active site or a given site (site_id); from and to required; pageSize max 25 with opaque cursor',
  list_invoices:
    'List invoices for the active site by status, customer, order, issue date, or number (keyset cursor, newest first)',
  get_invoice:
    'Get an invoice for the active site: lines, net/tax/gross totals, seller as printed on the PDF, order links, and credit notes',
  list_bays: 'List active bays for the active site (paged)',
  list_bins: 'List bin storage locations for the active site (paged)',
  list_workshop_tasks:
    'List workshop tasks the caller may see, including line IDs (paged)',
  list_workshop_slots:
    'List free workshop bay slots at the active site for a UTC window (max 8 days), duration, and optional bay (pageSize max 25, opaque cursor). Read-only snapshot; re-check before booking',
  list_available_loaners:
    'List loaner vehicles available at the active site for a UTC window (max 8 days) using fleet booking rules (pageSize max 25, opaque cursor). Read-only snapshot; re-check before booking',
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
    'Vehicle history: Pickerl status and the newest inspections, with compact orders (paged with orders_cursor) and the first page of documents for the active site (list_documents for more)',
  get_vehicle_context:
    'Compact vehicle work context by section (identity, open_workshop, inspections, documents, warranty_claims, warranty_periods): real IDs and document refs, as_of, per-section totals and cursors. Operational sections need the active site. Context only, not a legal warranty promise',
  list_documents:
    'List stored PDFs for the active site (invoice, credit_note, workshop_order, vehicle_sale_contract), filtered by type, customer, vehicle, or owner record; newest first (keyset cursor, max 25)',
  get_document_pdf:
    'Metadata and a read link for one stored PDF by document ID (<type>:<uuid>). The link expires within 15 minutes; PDF bytes are never returned',
  get_tenant_settings:
    'Non-secret tenant settings: currency, active site timezone, feature flags (decision apply mode, voice and catalog configuration as booleans, tyre storage), and a document branding summary per active legal entity. Secrets are never returned',
  list_sites:
    'Sites for the session tenant with an address summary and active flag (paged: pageSize max 25, opaque cursor). Inactive sites are listed for OWNER and ADMIN only',
  get_legal_entity:
    'Seller identity as printed on invoices (name, UID, address, contact, registration), bank details reduced to their last 4 characters (fewer for short values), accounting profile status, revenue group tax rates, and number ranges. Defaults to the active site legal entity',
  list_purchase_orders:
    'List purchase orders for the active site by status, vendor, order date range, or part, newest first (keyset cursor, max 25)',
  get_purchase_order:
    'Get a purchase order for the active site: status, lines with part, ordered and received quantities, net unit cost and line net, net total, vendor, and receipt summary',
  list_vendors:
    'List vendors, newest first (keyset cursor, max 25): id, name, and active. Bank and contact details are never returned',
  list_catalog_items:
    'Catalog parts (default) or labor operations (type labor) by query, active flag, and type; EUR net price per row, no cost prices (pageSize max 25, opaque cursor)',
  get_catalog_item:
    'Catalog part by ID: details, tax class, brand, default bin at the active site and default vendor, cost and net price, and the last 5 price history rows',
  list_price_lists:
    'Applied supplier price lists (import jobs) with vendor, applied date as valid_from, and item count, newest first (pageSize max 25, keyset cursor)',
  list_margin_rules:
    'Active margin rules, the ones the price engine applies, in priority order: scope (brand, revenue group, EUR cost bracket), markup percent or supplier RRP, and rounding (pageSize max 25, opaque cursor)',
  get_workshop_kpi_report:
    'Workshop KPIs for a period (from and to) at the active site or a given site (site_id): utilisation (Auslastung), productivity (Leistungsgrad), average net revenue per order, labor and parts net revenue, and parts turnover. Totals only; read only',
  get_revenue_report:
    'Revenue for a period (from and to, max 366 days) at the active site or a given site (site_id): net, VAT, and gross totals split by workshop, vehicle sales, and other sources, plus revenue groups. Finalized credit notes in the period are subtracted. Optional compare_previous adds the prior period of equal length. Read only',
  list_pickerl_due:
    'Vehicles with a Pickerl due within 30, 60, or 90 days (window, default 30), overdue vehicles always included: vehicle, customer name, status, and due date (last day of the due month). Overdue first, then by due month (pageSize max 25, opaque cursor)',
  get_nova_preview:
    'Read-only NoVA calculation for a vehicle at a net EUR price. Nothing is saved and no invoice changes. The result always states that the Steuerberater must still confirm while an unconfirmed rule applies',
  draft_workshop_order:
    'Create a DRAFT/SCHEDULED workshop order (policy-checked, logged)',
  reserve_part:
    'Reserve on-hand stock for a catalog-backed part line from a bin (the line needs a catalog_item_id; a free-text line fails with NOT_A_CATALOG_LINE); AUTO at or below policy amount_max (EUR 250 platform cap), PROPOSE above amount_max (reversible; counter-tool: release_reservation)',
  release_reservation:
    'Release a parts reservation (counter-tool of reserve_part)',
  propose_line_item:
    'Propose a workshop task line item (PART, LABOR, or FEE; never executes; records a pending proposal)',
  propose_registration_intake:
    'Propose applying a reviewed registration document intake (never executes; records a pending proposal)',
  propose_workshop_booking:
    'Propose a scheduled workshop order with an optional reserved loaner booking and optional loaner_charge FEE line (never executes alone; records one pending proposal)',
  propose_purchase_order:
    'Propose a DRAFT purchase order from verified local parts requisition demand (never sends externally; records one pending proposal)',
  propose_workshop_order_completion:
    'Propose completing open workshop tasks on an order and moving it to a derived completed status when all tasks are done; optional ready-for-pickup email only when notify_customer is true and the action is applied (never finalizes invoices)',
  propose_invoice_draft_from_order:
    'Propose a DRAFT invoice from a COMPLETED workshop order (never finalizes, sends, or records payment; records one pending proposal)',
  propose_estimate_send:
    'Propose creating or revising a workshop estimate (KVA) and emailing the customer an online approval link (never sends without human apply; records one pending proposal)',
  request_workshop_media_upload:
    'Reserve a short-lived direct upload slot for workshop task media (jpeg, png, heic, or webp). Does not change workshop business state until a finding or other flow references the returned media_id',
  propose_mechanic_finding:
    'Propose an additional mechanic finding with photos for advisor review (never sends customer messages; records one pending proposal)',
  propose_customer_create:
    'Propose a new customer record for human approval (never executes; records one pending proposal). The tenant is checked for a duplicate e-mail, phone, UID, or name and postcode before the proposal is stored, and an exact e-mail or UID hit is refused with DUPLICATE_CUSTOMER so the agent can propose an update instead. Consent fields are rejected by the schema; consent stays human-only | DE: Schlägt einen neuen Kundenstammdatensatz zur menschlichen Freigabe vor (führt nie selbst aus; legt genau einen offenen Vorschlag an). Vor dem Speichern wird auf doppelte E-Mail, Telefon, UID oder Name und PLZ geprüft; ein exakter Treffer bei E-Mail oder UID wird mit DUPLICATE_CUSTOMER abgelehnt, damit stattdessen eine Änderung vorgeschlagen werden kann. Einwilligungsfelder werden vom Schema abgelehnt; Einwilligung bleibt ausschließlich menschlich',
  propose_customer_update:
    'Propose a change to the master data of an existing customer for human approval (never executes; records one pending proposal). Only the changed fields and the customer id are stored, and the approval re-checks that the customer still exists, that the e-mail is still free, and that the customer still has the values the proposal was based on. Consent fields are rejected by the schema; consent stays human-only | DE: Schlägt eine Änderung der Stammdaten eines bestehenden Kunden zur menschlichen Freigabe vor (führt nie selbst aus; legt genau einen offenen Vorschlag an). Es werden nur die geänderten Felder und die Kunden-ID gespeichert; bei der Freigabe wird erneut geprüft, ob der Kunde noch existiert, ob die E-Mail noch frei ist und ob der Kunde noch die Werte des Vorschlags hat. Einwilligungsfelder werden vom Schema abgelehnt; Einwilligung bleibt ausschließlich menschlich',
  generate_weekly_report_pdf:
    'Render the internal weekly report PDF for one ISO calendar week (Monday through Sunday in the site timezone) and return a short-lived read link. Does not archive the PDF or send anything externally',
};
