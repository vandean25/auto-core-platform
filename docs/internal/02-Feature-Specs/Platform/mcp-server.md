# MCP server (AE5) — phase 2 read and write tools

## Summary

Exposes Auto Core Platform data to MCP clients over **Streamable HTTP** at `/api/mcp`, authenticated with the same Firebase/JWT session as the REST API. Every tool call is recorded in `agent_action_logs` (AE2) with its applicable policy tier and trace ID. The HTTP middleware accepts `X-Trace-Id` or generates one, echoes it in the response header, and successful write results also include `trace_id`.

Agent-facing usage rules and recipes are maintained in [the MCP AGENTS.md](../../../../apps/core-api/src/mcp/AGENTS.md). Its tool and never-exposed action tables are checked against the registered MCP constants by Jest.

Includes both read-only tools (phase 1) and write tools (phase 2) with policy evaluation and dry-run capabilities.

## Feature flag

| Variable | Default | Behaviour |
|----------|---------|-----------|
| `MCP_SERVER_ENABLED` | `false` | When not `true`, `/api/mcp` responds with **404**. |

## Authorization

| Role | Access |
|------|--------|
| `OWNER` | Yes |
| `ADMIN` | Yes |
| `SALES` (ADVISOR) | Yes |
| `TECH` | No (same as back-office REST) |

Tenant isolation matches existing services (`tenant_id` from the session). Site-scoped tools use the user’s **active site** (ADR-0022), same as workshop and inventory APIs.

## Read-only tools (phase 1)

| Tool | Tier | Description |
|------|------|-------------|
| `search_customers` | AUTO | Paged customer search |
| `get_customer` | AUTO | Customer contact data, vehicles, and a compact order history (paged with `orders_cursor`, max 25) |
| `search_vehicles` | AUTO | Paged vehicle search |
| `get_vehicle` | AUTO | Vehicle detail by id |
| `get_vehicle_listing_status` | AUTO | Per-portal marketplace listing status for a vehicle at the active site (desired, export, and remote state) |
| `get_vehicle_history` | AUTO | Tenant vehicle: Pickerl status, the newest ten inspections, and compact orders (paged) and the first page of documents for the active site |
| `get_vehicle_context` | AUTO | Compact vehicle work context by section (identity, open workshop orders, inspections, documents, warranty claims, Gewährleistung periods) with per-section totals and cursors; operational sections require the active site |
| `list_workshop_orders` | AUTO | Paged workshop orders (active site) by order status, current estimate status, scheduled date, or estimate sent date |
| `get_workshop_order` | AUTO | Workshop order by id (active site) |
| `search_parts` | AUTO | Inventory search; optional `workshop_order_id` uses workshop catalog search |
| `get_stock_level` | AUTO | Stock for `sku` or `catalog_item_id` (active site) |
| `get_vehicle_stock_age_report` | AUTO | Paged dealer stock age and current cost basis for the active site or a given `site_id`, with an optional stock-in window (`from`/`to`), `pageSize` max 25, opaque cursor |
| `get_vehicle_stock_margin_report` | AUTO | Paged invoiced vehicle margin report for a date period (`from`/`to`) for the active site or a given `site_id`, `pageSize` max 25, opaque cursor |
| `list_invoices` | AUTO | Paged invoices for the active site by status, customer, order, issue date, or number, newest first (keyset cursor) |
| `get_invoice` | AUTO | Invoice for the active site: lines, net, tax, and gross totals, seller as printed, order links, and credit notes |
| `list_documents` | AUTO | Paged stored PDFs for the active site (invoice, credit note, workshop job card, vehicle sale contract) by type, customer, vehicle, or owner record, newest first (keyset cursor) |
| `get_document_pdf` | AUTO | Metadata and a read link that expires within 15 minutes for one stored PDF by `<type>:<uuid>` ID; never PDF bytes |
| `get_tenant_settings` | AUTO | Non-secret tenant settings: currency, active site timezone, feature flags, and a document branding summary per active legal entity |
| `list_sites` | AUTO | Sites of the session tenant with an address summary and active flag, paged with `pageSize` (max 25) and an opaque cursor |
| `get_legal_entity` | AUTO | Seller identity as printed on invoices, bank details masked to their last four characters, accounting profile status, tax rates, and number ranges |
| `list_purchase_orders` | AUTO | Paged purchase orders for the active site by status, vendor, part, or order date range, newest first (keyset cursor) |
| `get_purchase_order` | AUTO | Purchase order for the active site: status, lines with part and quantities, net unit cost and line net, net total, vendor, and a receipt summary |
| `list_vendors` | AUTO | Paged tenant vendors, newest first (keyset cursor): id, name, and active; no bank or contact details |
| `list_catalog_items` | AUTO | Paged catalog parts, or labor operations with `type` labor, by query, active flag, and type, with net prices (pageSize max 25, keyset cursor) |
| `get_catalog_item` | AUTO | Catalog part by ID: tax class, brand, cost and net price, default bin and vendor, and the last five price history rows |
| `list_price_lists` | AUTO | Paged applied supplier price lists with vendor, applied date as `valid_from`, and item count, newest first (pageSize max 25, keyset cursor) |
| `list_margin_rules` | AUTO | Paged active margin rules, the ones the price engine applies, in priority order, with scope, markup, and rounding (pageSize max 25, keyset cursor) |
| `get_workshop_kpi_report` | AUTO | Workshop KPIs for a period (`from`/`to`) at the active site or a given `site_id`: utilisation, productivity, revenue per order, and parts turnover (totals only) |
| `get_revenue_report` | AUTO | Revenue for a period (`from`/`to`, max 366 days) at the active site or a given `site_id`: net, VAT, and gross split by workshop, vehicle sales, and other, plus revenue groups; optional `compare_previous` |
| `list_pickerl_due` | AUTO | Vehicles with a Pickerl due within a 30, 60, or 90 day `window`, overdue vehicles always included: vehicle, customer name, and due date (`pageSize` max 25, opaque cursor) |
| `get_nova_preview` | AUTO | Read-only NoVA calculation for `vehicle_id` at a `net_price_eur`; nothing is saved and no invoice changes; the Steuerberater must still confirm while an unconfirmed rule applies |
| `list_bays` | AUTO | Paged active bays for the active site |
| `list_bins` | AUTO | Paged bin storage locations for the active site |
| `list_workshop_tasks` | AUTO | Paged tasks visible to the caller with line IDs for MCP actions |
| `list_workshop_slots` | AUTO | Paged free bay slots at the active site for a UTC window (max 8 days), required `duration_minutes`, optional `bay_id`; snapshot only |
| `list_available_loaners` | AUTO | Paged loaner vehicles available at the active site for a UTC window (max 8 days); snapshot only |
| `whoami` | AUTO | Caller identity, role, tenant, active site, and decision apply mode (no input) |
| `get_capabilities` | AUTO | Paged tools for the caller with policy tier, enabled state, and disabled reason; HUMAN_ONLY action names |
| `list_audit_events` | AUTO | Paged tenant audit events, newest first, filtered by entity, actor, action, date range, or trace ID (OWNER and ADMIN only) |
| `get_entity_history` | AUTO | Paged field changes for one entity, with email, phone, and address values masked (OWNER and ADMIN only) |
| `get_agent_action` | AUTO | Agent action log rows for a trace ID, plus up to 25 correlated audit entries (OWNER and ADMIN only) |
| `list_agent_actions` | AUTO | Paged agent action log rows filtered by agent, tool, tier, status, or time range (OWNER and ADMIN only) |

## Compliance read-only tools

| Tool | Tier | Description |
|------|------|-------------|
| `check_contact_permission` | AUTO | Consent gate: `allowed` and `reason` for a `customer_id`, `purpose`, and `channel` (no ledger text); same roles as the consent ledger REST API |
| `list_gewaehrleistung_due` | AUTO | Gewährleistung period ending within `within_days` (30, 60, or 90) at the active site (`pageSize` max 25, opaque cursor) |
| `list_tyre_sets` | AUTO | Tyre storage sets at the active site by `customer_id`, `vehicle_id`, `status`, or `due_for_swap` (`pageSize` max 25, opaque cursor) |
| `list_warranty_claims` | AUTO | Warranty claims at the active site, optional `order_id`, `status`, and `type` (`pageSize` max 25, keyset cursor; compact rows without complaint text) |

Outputs are page-limited (max 25 rows) and JSON size-capped before returning to the client. Summaries written to the action log are redacted per AE2.

`whoami` and `get_capabilities` (AUT-454) are identity and capability reads, and both are logged like other reads. `whoami` takes no input: an agent session reports itself as `caller` with `type: agent`, while `role`, `tenant`, `site`, and `mode` come from the session and the tenant's decision apply mode, never from tool arguments. `get_capabilities` reads each write tool's tier and enabled state from the agent policy (tenant override, else platform default), reports a disabled rule as `enabled: false` with `disabled_reason: policy_disabled`, and never lists a HUMAN_ONLY action as a tool; those action names appear in `human_only_actions`. It pages with `pageSize` (default and max 25; the catalog holds 59 tools, so follow `cursor` to reach the rest) and an opaque `cursor`. The AUT-455 reads below use the same convention.

The audit and agent action reads (AUT-455), `list_audit_events`, `get_entity_history`, `get_agent_action`, and `list_agent_actions`, read the audit trail and the agent action log for the session tenant only. They need OWNER or ADMIN (`MCP_SUPERVISOR_ROLES`), so a SALES session gets a `ForbiddenException` from them. `get_capabilities` lists them for that session with `enabled: false` and `disabled_reason: role_not_permitted`. The audit and agent action lists page newest first with a keyset `cursor` (`pageSize` default 10, max 25). A page is capped at 32 KB: rows that would exceed it are dropped, `truncated` is set, and `next_cursor` resumes after the last row kept. Contact data in before, after, and change values is masked before it leaves the server: email addresses keep their first letter and domain (`j***@example.com`), phone numbers keep their last two digits, and address fields become `***`. Personal names are not masked. `get_agent_action` returns the log rows for a trace and the first 25 correlated audit entries; `list_audit_events` with `trace_id` pages the rest. Audit rows written by `AuditService.recordTenantMutation` now carry the agent trace in `request_id` in lowercase form, as the Prisma audit extension already did for updates and deletes. The audit reads lowercase their trace filter to match.

The invoice reads (AUT-456), `list_invoices` and `get_invoice`, are AUTO and read the session tenant's invoices at the active site (ADR-0022), as the vehicle stock margin report does. An invoice at another site is not found. `list_invoices` filters by `status`, `customer_id`, `order_id` (a workshop or sales order), an inclusive issue-date range (`from` and `to`, UTC days), and `number` (partial match). It pages with a keyset `cursor` (`pageSize` default 10, max 25) and drops trailing rows that would exceed the 32 KB cap. `get_invoice` returns lines, net, tax, and gross totals, the customer's ID and name, the linked workshop and sales orders, and the credit notes. For a committed invoice, lines, totals, and the `seller` block come from the same snapshot the PDF renders, so `seller` is the identity as printed (AUT-298). Drafts and invoices without a usable snapshot report the stored rows with `amount_source: stored`; drafts have no seller block. Amounts are EUR decimal strings. A list row's `total_gross` is the snapshot total for a committed invoice with a usable snapshot, the figure the PDF prints. A draft, or a committed invoice without a usable snapshot, shows its stored total. Customer contact data and internal notes are never returned.

The customer and vehicle history and the document reads (AUT-459) are AUTO and tenant-scoped. Order, invoice, and document queries use the active site (ADR-0022); the vehicle itself is tenant-scoped, as in `get_vehicle`. `get_customer` keeps the contact data and vehicles and returns `orders` in place of the nested REST history arrays, which push a result past the 32 KB cap. `orders` merges workshop and sales orders newest first; `total_gross` is the linked invoice's gross total once that invoice is committed, and it is `null` while the invoice is a draft or the order has none. `get_vehicle_history` returns the vehicle's Pickerl status, its newest ten inspections, its orders, and the first page of its documents. `list_documents` lists the PDFs that exist, for invoices, credit notes, workshop job cards, and vehicle sale contracts. `get_document_pdf` takes a `<type>:<uuid>` ID and returns metadata and a V4 read link, clamped to `PDF_READ_LINK_MAX_TTL_SECONDS` (15 minutes). PDF bytes are never returned. The action log keeps the document, type, owner, and expiry, never the URL. A link is issued only for an object read from a row the tenant and active site own, so another tenant's document is not found. Issuing a link needs a signing-capable credential for the PDF bucket on the API service.

The settings reads (AUT-457), `get_tenant_settings`, `list_sites`, and `get_legal_entity`, are AUTO and read only, and every MCP role (OWNER, ADMIN, and SALES) may call them. Every query is scoped by the session tenant. The REST services behind these settings are OWNER and ADMIN only, so the MCP reads query the tables directly and do not call them. `get_tenant_settings` is an explicit allowlist: currency (EUR, the only invoicing currency), the active site timezone, the effective decision apply mode, voice translation and catalog configuration as booleans, tyre storage swap dates, and a branding summary per active legal entity. It has no tenant locale, because none is stored, and it never returns secrets, service account material, project IDs, or credential references. `list_sites` applies the names-only directory rule: active sites for any caller with an active site membership, and inactive sites too for OWNER and ADMIN. It pages with `pageSize` (default 10, max 25) and an opaque cursor. `get_legal_entity` returns the seller identity with the same field names as the invoice `seller` block, without representatives, which are personal names. Bank identifiers (IBAN, BIC, and bank name) are reduced to their last four characters, and a short value shows at most half its characters. The accounting profile is reported as status only, without advisor or client numbers. Tax rates come from the revenue groups. Number ranges give the next number per document type; invoice, credit note, and workshop estimate use the current year's sequence. The `seller` block of `get_invoice` still returns bank identifiers in full, as the PDF prints them. Masking it is a follow-up and was not changed here.

The purchasing reads (AUT-458), `list_purchase_orders`, `get_purchase_order`, and `list_vendors`, are AUTO and tenant-scoped. Purchase orders are read at the active site (ADR-0022), as the purchase list is, so an order at another site is not found; vendors are tenant-wide master data and are listed by tenant only. `list_purchase_orders` filters by `status`, `vendor_id`, `part_id` (a catalog part on at least one line), and an inclusive order-date range (`from` and `to`, UTC days). It pages with a keyset `cursor` over creation time and ID, newest first (`pageSize` default 10, max 25), and drops trailing rows that would exceed the 32 KB cap. `ordered_at` is the order's creation time, since a purchase order has no separate order date. Amounts are net EUR decimal strings: a line's `line_net` is its quantity times its net unit cost, rounded half-up to the cent, and the order total sums those rounded lines. The receipt summary counts the goods-receipt ledger rows (`PURCHASE_RECEIPT`) booked against the order number at its site and gives the newest one's time; receipt detail is not returned. Lines are capped like invoice lines, with `lines_total` and `lines_truncated`. `list_vendors` returns `id`, `name`, and `active`. The vendor model has no deactivation flag, so `active` is `true` for every listed vendor; removing a vendor deletes it. The account number and the contact email are never returned. `propose_purchase_order` (AUT-539) is the only purchase write tool: PROPOSE-only, default off, server-built preview with net amounts and cost sources, apply creates a single `DRAFT` through requisition rules. Sending, receiving, and approving purchase orders are not tools.

The catalog and price reads (AUT-460), `list_catalog_items`, `get_catalog_item`, `list_price_lists`, and `list_margin_rules`, are AUTO and read only. Every MCP role may call them, and every query is scoped by the session tenant. The catalog, labor, vendor, margin, and price list tables are tenant-wide, so only the default bin reads the active site (ADR-0022). No cost price is hidden: the platform has no role policy for purchase cost, and the list rows never carry one. Amounts and percents are EUR decimal strings with two places.

`list_catalog_items` lists parts by default. `type` `labor` lists `LaborOperation` rows in the same row shape, with the operation code as `sku`, `h` as the unit, and the hourly rate as `price_net`, because labor is not stored in `catalog_items`. A part is active unless another part supersedes it, and `active` filters on that. `get_catalog_item` has no field for a default bin or a default vendor, so the default bin is the active site's bin with the most stock, never a warehouse location or a deleted bin, and the default vendor is the supplier article link updated most recently. `list_price_lists` lists the applied `SUPPLIER_PRICE_LIST` import jobs. The import has no validity date, so `valid_from` is the applied time, and `items_count` is the row count of the file. Dry runs are not listed. `list_margin_rules` lists the active rules, the ones the price engine evaluates, in priority order. Inactive rules are not listed. The three lists page with `pageSize` (default 10, max 25) and an opaque keyset cursor. The price history of `get_catalog_item` is the newest five rows, with no paging. None of these reads runs an import or writes a price.
The report reads (AUT-461), `get_workshop_kpi_report`, `list_pickerl_due`, and `get_nova_preview`, are AUTO and read only. `get_vehicle_stock_age_report` and `get_vehicle_stock_margin_report` share one input contract: an optional `site_id` (default the active site), `pageSize` (max 25) with an opaque `cursor`, and a date range, where the age report's range is the stock-in window. Each report calls its domain service (`WorkshopKpiReportsService`, `VehicleStockReportsService`, `VehicleService.getPickerlDueData`, `NovaCalculationService`), and the MCP layer only maps the result to a compact payload with EUR decimal strings. The stock reports page by offset because their domain services do; the cursor is opaque to clients. The Pickerl list pages the same way over its sorted rows, and its `due_date` is the last day of the sticker's due month. The NoVA preview writes nothing and sends nothing. Its result always carries a note that the Steuerberater must still confirm while any unconfirmed rule applies.

## Write tools (phase 2)

| Tool | Default Tier | Reversibility | Counter-tool |
|------|--------------|---------------|--------------|
| `draft_workshop_order` | Off by default; AUTO when enabled | Reversible through the workshop order cancellation workflow | Manual workshop order cancellation |
| `reserve_part` | Off by default; AUTO up to the policy amount limit, otherwise PROPOSE | Reversible via `release_reservation` | `release_reservation` |
| `release_reservation` | Off by default; AUTO when enabled | Reversible via `reserve_part` (subject to stock availability) | `reserve_part` |
| `propose_line_item` | Off by default; PROPOSE when enabled | Preview only; the proposed line item is rolled back and not persisted | Not applicable |
| `propose_registration_intake` | Off by default; PROPOSE when enabled (hard-clamped from AUTO) | Applies a reviewed registration intake to customer/vehicle records | Not applicable |
| `propose_workshop_booking` | Off by default; PROPOSE when enabled (hard-clamped from AUTO) | Proposes a scheduled workshop order with an optional reserved loaner booking in one package | Not applicable |
| `propose_purchase_order` | Off by default; PROPOSE when enabled (hard-clamped from AUTO) | Proposes a DRAFT purchase order from verified local parts requisition demand; apply uses requisition PO rules and never sends externally | Not applicable |
| `propose_workshop_order_completion` | Off by default; PROPOSE when enabled (hard-clamped from AUTO) | Proposes completing open workshop tasks on an order and deriving order status when all tasks are done; optional ready-for-pickup email on apply when `notify_customer` is true; never finalizes invoices | Not applicable |
| `propose_invoice_draft_from_order` | Off by default; PROPOSE when enabled (hard-clamped from AUTO) | Proposes a DRAFT invoice from a COMPLETED workshop order with line/total/recipient preview; apply creates only the draft; never finalizes, sends, or records payment | Not applicable |
| `propose_estimate_send` | Off by default; PROPOSE when enabled (hard-clamped from AUTO) | Proposes creating or revising a workshop estimate and emailing the customer an online approval link; apply sends through the existing estimate service; never sends without human apply | Not applicable |
| `request_workshop_media_upload` | Off by default; AUTO when enabled | Reserves a short-lived GCS upload slot for workshop task photos; returns `media_id` and presigned POST fields without bucket credentials | Not applicable |
| `propose_mechanic_finding` | Off by default; PROPOSE when enabled (hard-clamped from AUTO) | Proposes an additional mechanic finding with photos for internal advisor review; apply acknowledges the finding; never sends customer messages | Not applicable |
| `generate_weekly_report_pdf` | Off by default; AUTO when enabled | Renders the internal weekly report PDF for one ISO week (Monday–Sunday in the site timezone), stores it under a short-lived GCS prefix, and returns a signed read link; never archives the PDF or sends anything externally | Not applicable |

`propose_purchase_order` accepts multiple lines with the same `catalog_item_id` when each line references a different requisition reservation slice. Vendor master data has no active/inactive flag: another tenant's vendor id is rejected as not found, and there is no separate inactive-vendor check. Net unit cost for a vendor uses the supplier article row with the newest `updatedAt` (then lowest id) per catalog item, matching catalog read default-supplier semantics.

`reserve_part` requires a catalog-backed part line and a bin `location_id` at the active site. Its existing EUR 250 `amount_max` policy allows `AUTO` at or below the configured amount and returns `PROPOSE` above it. Scheduled `draft_workshop_order` inputs require `bay_id`, `scheduled_start_at`, and `scheduled_end_at`.

Write tools follow a shared pipeline: policy evaluation → immediate refusal for disabled / HUMAN_ONLY actions → DryRunService rollback preview (`would_change`) for enabled actions → outcome by evaluated tier:
- **AUTO**: Execute immediately, log as EXECUTED
- **PROPOSE**: Requires human approval, log as PROPOSED
- **HUMAN_ONLY**: Return `not_permitted` (HTTP 403) without preview or execution, log as REFUSED
- **NOT_EVALUATED** (schema-invalid input, rejected before policy evaluation, e.g. `draft_workshop_order` with any `status` other than `SCHEDULED`): return a validation error without preview or execution, log as FAILED with tier `NOT_EVALUATED`. No policy tier applies, so this row is never logged as PROPOSE.

Preview ids are provisional. The preview rolls back, so a row it creates is not kept, and the committed write creates a different id. Each `would_change` item carries `provisional`: `true` for a created row, or a change to one, and `false` for a change to an existing row, which keeps its committed id. A `needs_approval` response sets `proposal.provisional` to `true`, since nothing is committed until the pending action is applied. Callers must not open, release, or reuse a provisional id: an `executed` write returns the committed id in `result.id`, and after approval the committed row is read back.

Note: `propose_line_item` is hard-clamped to PROPOSE tier and cannot be loosened to AUTO. All MCP write rules start disabled in the platform policy table; a tenant admin must enable each rule before the write can proceed. Disabled rules fail closed with `not_permitted` (HTTP 403). Every write tool accepts optional `dry_run: true` to preview policy and effects without writing; agents should dry-run first, then call for real. Enabled non-dry AUTO calls proceed to execution after the internal preview; PROPOSE calls return `needs_approval` with a pending action ID and do not execute the proposed action. Tenant policy can be stricter than the platform floor, never looser.

## Never-exposed actions

The following actions are intentionally never exposed as MCP tools, as they require human oversight or are withheld from agent automation per policy:

- Invoice finalization (`invoice.finalize`)
- Invoice cancellation and sending (`invoice.cancel`, `invoice.send`)
- Credit note creation, issuance, and finalization (`credit_note.create`, `credit_note.issue`, `credit_note.finalize`)
- Payment recording and RKSV fiscal receipt signing or cancellation (`payment.record`, `fiscal_receipt.sign`, `fiscal_receipt.cancel`)
- Accounting exports (`accounting_export.create`, `accounting_export.submit`)
- Deletions of customers, vehicles, or workshop orders
- User/role/consent changes (`tenant_member.role_change`, `tenant_member.invite`, `consent.update`, `consent.revoke`)
- Legal entity, tax rate, and number range changes (`legal_entity.update`, `tax_rate.update`, `number_range.update`). The settings reads (AUT-457) expose these values read only.

Estimate customer email is exposed only as `propose_estimate_send` (policy action `estimate.send_customer_message`, pending apply `estimate.send_customer_message`), always PROPOSE-clamped.

These align with the `MCP_NEVER_EXPOSED_ACTIONS` constant in the MCP implementation. `invoice.cancel` and `invoice.send` are not in the agent policy catalog yet, so they fail closed as HUMAN_ONLY (unknown action types). `credit_note.create` falls under the `credit_note.` hard floor, so it is HUMAN_ONLY by category. All three are withheld from the tool list.

## Agent identity

`agent_id` is `mcp:<clientInfo.name>` from the MCP `initialize` request (e.g. `mcp:cursor`).

## Local MCP client

1. Start API with `MCP_SERVER_ENABLED=true` and a normal dev `.env`.
2. Sign in via the web app (or use a test JWT in `NODE_ENV=test`).
3. Point an MCP client at Streamable HTTP URL `http://127.0.0.1:3000/api/mcp` with header `Authorization: Bearer <token>`.
4. Optionally send a UUID in `X-Trace-Id`; otherwise the server generates one. The response echoes `X-Trace-Id`, and successful write results include `trace_id`. An authorized caller can use it with `GET /api/agent-actions/:traceId`.

Example Cursor / MCP config fragment:

```json
{
  "mcpServers": {
    "acp-local": {
      "url": "http://127.0.0.1:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer <firebase-or-test-jwt>"
      }
    }
  }
}
```

Use the MCP Inspector or the official TypeScript SDK `Client` + `StreamableHTTPClientTransport` to list tools and invoke them.

## Testing

- Unit: Zod tool schemas, MCP RBAC helper, audit read service and PII masking, the 32 KB page cap, invoice reads (tenant and site scope, filters, paging, and amounts checked against the PDF source data).
- E2E: `apps/core-api/test/mcp.e2e-spec.ts` (flag off, RBAC, tool list, action log row, tenant isolation, audit reads).

## Out of scope (phase 2)

OAuth dynamic client registration, public hardening, destructive tools, deploy.
