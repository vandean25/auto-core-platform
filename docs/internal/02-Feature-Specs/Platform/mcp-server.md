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
| `get_vehicle_history` | AUTO | Tenant vehicle: Pickerl status, the newest ten inspections, and compact orders (paged) and the first page of documents for the active site |
| `list_workshop_orders` | AUTO | Paged workshop orders (active site) |
| `get_workshop_order` | AUTO | Workshop order by id (active site) |
| `search_parts` | AUTO | Inventory search; optional `workshop_order_id` uses workshop catalog search |
| `get_stock_level` | AUTO | Stock for `sku` or `catalog_item_id` (active site) |
| `get_vehicle_stock_age_report` | AUTO | Paged vehicle stock age and current cost basis (active site) |
| `get_vehicle_stock_margin_report` | AUTO | Paged invoiced vehicle margin report for a date period (active site) |
| `list_invoices` | AUTO | Paged invoices for the active site by status, customer, order, issue date, or number, newest first (keyset cursor) |
| `get_invoice` | AUTO | Invoice for the active site: lines, net, tax, and gross totals, seller as printed, order links, and credit notes |
| `list_documents` | AUTO | Paged stored PDFs for the active site (invoice, credit note, workshop job card, vehicle sale contract) by type, customer, vehicle, or owner record, newest first (keyset cursor) |
| `get_document_pdf` | AUTO | Metadata and a read link that expires within 15 minutes for one stored PDF by `<type>:<uuid>` ID; never PDF bytes |
| `list_bays` | AUTO | Paged active bays for the active site |
| `list_bins` | AUTO | Paged bin storage locations for the active site |
| `list_workshop_tasks` | AUTO | Paged tasks visible to the caller with line IDs for MCP actions |
| `whoami` | AUTO | Caller identity, role, tenant, active site, and decision apply mode (no input) |
| `get_capabilities` | AUTO | Paged tools for the caller with policy tier, enabled state, and disabled reason; HUMAN_ONLY action names |
| `list_audit_events` | AUTO | Paged tenant audit events, newest first, filtered by entity, actor, action, date range, or trace ID (OWNER and ADMIN only) |
| `get_entity_history` | AUTO | Paged field changes for one entity, with email, phone, and address values masked (OWNER and ADMIN only) |
| `get_agent_action` | AUTO | Agent action log rows for a trace ID, plus up to 25 correlated audit entries (OWNER and ADMIN only) |
| `list_agent_actions` | AUTO | Paged agent action log rows filtered by agent, tool, tier, status, or time range (OWNER and ADMIN only) |

Outputs are page-limited (max 25 rows) and JSON size-capped before returning to the client. Summaries written to the action log are redacted per AE2.

`whoami` and `get_capabilities` (AUT-454) are identity and capability reads, and both are logged like other reads. `whoami` takes no input: an agent session reports itself as `caller` with `type: agent`, while `role`, `tenant`, `site`, and `mode` come from the session and the tenant's decision apply mode, never from tool arguments. `get_capabilities` reads each write tool's tier and enabled state from the agent policy (tenant override, else platform default), reports a disabled rule as `enabled: false` with `disabled_reason: policy_disabled`, and never lists a HUMAN_ONLY action as a tool; those action names appear in `human_only_actions`. It pages with `pageSize` (default and max 25; the catalog holds 28 tools, so follow `cursor` to reach the rest) and an opaque `cursor`. The AUT-455 reads below use the same convention.

The audit and agent action reads (AUT-455), `list_audit_events`, `get_entity_history`, `get_agent_action`, and `list_agent_actions`, read the audit trail and the agent action log for the session tenant only. They need OWNER or ADMIN (`MCP_SUPERVISOR_ROLES`), so a SALES session gets a `ForbiddenException` from them. `get_capabilities` lists them for that session with `enabled: false` and `disabled_reason: role_not_permitted`. The audit and agent action lists page newest first with a keyset `cursor` (`pageSize` default 10, max 25). A page is capped at 32 KB: rows that would exceed it are dropped, `truncated` is set, and `next_cursor` resumes after the last row kept. Contact data in before, after, and change values is masked before it leaves the server: email addresses keep their first letter and domain (`j***@example.com`), phone numbers keep their last two digits, and address fields become `***`. Personal names are not masked. `get_agent_action` returns the log rows for a trace and the first 25 correlated audit entries; `list_audit_events` with `trace_id` pages the rest. Audit rows written by `AuditService.recordTenantMutation` now carry the agent trace in `request_id` in lowercase form, as the Prisma audit extension already did for updates and deletes. The audit reads lowercase their trace filter to match.

The invoice reads (AUT-456), `list_invoices` and `get_invoice`, are AUTO and read the session tenant's invoices at the active site (ADR-0022), as the vehicle stock margin report does. An invoice at another site is not found. `list_invoices` filters by `status`, `customer_id`, `order_id` (a workshop or sales order), an inclusive issue-date range (`from` and `to`, UTC days), and `number` (partial match). It pages with a keyset `cursor` (`pageSize` default 10, max 25) and drops trailing rows that would exceed the 32 KB cap. `get_invoice` returns lines, net, tax, and gross totals, the customer's ID and name, the linked workshop and sales orders, and the credit notes. For a committed invoice, lines, totals, and the `seller` block come from the same snapshot the PDF renders, so `seller` is the identity as printed (AUT-298). Drafts and invoices without a usable snapshot report the stored rows with `amount_source: stored`; drafts have no seller block. Amounts are EUR decimal strings. A list row's `total_gross` is the snapshot total for a committed invoice with a usable snapshot, the figure the PDF prints. A draft, or a committed invoice without a usable snapshot, shows its stored total. Customer contact data and internal notes are never returned.

The customer and vehicle history and the document reads (AUT-459) are AUTO and tenant-scoped. Order, invoice, and document queries use the active site (ADR-0022); the vehicle itself is tenant-scoped, as in `get_vehicle`. `get_customer` keeps the contact data and vehicles and returns `orders` in place of the nested REST history arrays, which push a result past the 32 KB cap. `orders` merges workshop and sales orders newest first; `total_gross` is the linked invoice's gross total once that invoice is committed, and it is `null` while the invoice is a draft or the order has none. `get_vehicle_history` returns the vehicle's Pickerl status, its newest ten inspections, its orders, and the first page of its documents. `list_documents` lists the PDFs that exist, for invoices, credit notes, workshop job cards, and vehicle sale contracts. `get_document_pdf` takes a `<type>:<uuid>` ID and returns metadata and a V4 read link, clamped to `PDF_READ_LINK_MAX_TTL_SECONDS` (15 minutes). PDF bytes are never returned. The action log keeps the document, type, owner, and expiry, never the URL. A link is issued only for an object read from a row the tenant and active site own, so another tenant's document is not found. Issuing a link needs a signing-capable credential for the PDF bucket on the API service.

## Write tools (phase 2)

| Tool | Default Tier | Reversibility | Counter-tool |
|------|--------------|---------------|--------------|
| `draft_workshop_order` | Off by default; AUTO when enabled | Reversible through the workshop order cancellation workflow | Manual workshop order cancellation |
| `reserve_part` | Off by default; AUTO up to the policy amount limit, otherwise PROPOSE | Reversible via `release_reservation` | `release_reservation` |
| `release_reservation` | Off by default; AUTO when enabled | Reversible via `reserve_part` (subject to stock availability) | `reserve_part` |
| `propose_line_item` | Off by default; PROPOSE when enabled | Preview only; the proposed line item is rolled back and not persisted | Not applicable |

`reserve_part` requires a catalog-backed part line and a bin `location_id` at the active site. Its existing EUR 250 `amount_max` policy allows `AUTO` at or below the configured amount and returns `PROPOSE` above it. Scheduled `draft_workshop_order` inputs require `bay_id`, `scheduled_start_at`, and `scheduled_end_at`.

Write tools follow a shared pipeline: policy evaluation → immediate refusal for disabled / HUMAN_ONLY actions → DryRunService rollback preview (`would_change`) for enabled actions → outcome by evaluated tier:
- **AUTO**: Execute immediately, log as EXECUTED
- **PROPOSE**: Requires human approval, log as PROPOSED
- **HUMAN_ONLY**: Return `not_permitted` (HTTP 403) without preview or execution, log as REFUSED
- **NOT_EVALUATED** (schema-invalid input, rejected before policy evaluation, e.g. `draft_workshop_order` with any `status` other than `SCHEDULED`): return a validation error without preview or execution, log as FAILED with tier `NOT_EVALUATED`. No policy tier applies, so this row is never logged as PROPOSE.

Note: `propose_line_item` is hard-clamped to PROPOSE tier and cannot be loosened to AUTO. All MCP write rules start disabled in the platform policy table; a tenant admin must enable each rule before the write can proceed. Disabled rules fail closed with `not_permitted` (HTTP 403). The MCP write schemas do not accept a `dry_run` argument. Enabled AUTO calls proceed to execution after the internal preview; PROPOSE calls return `needs_approval` with a pending action ID and do not execute the proposed action. Tenant policy can be stricter than the platform floor, never looser.

## Never-exposed actions

The following actions are intentionally never exposed as MCP tools, as they require human oversight or are withheld from agent automation per policy:

- Invoice finalization (`invoice.finalize`)
- Invoice cancellation and sending (`invoice.cancel`, `invoice.send`)
- Credit note creation, issuance, and finalization (`credit_note.create`, `credit_note.issue`, `credit_note.finalize`)
- Accounting exports (`accounting_export.create`, `accounting_export.submit`)
- Deletions of customers, vehicles, or workshop orders
- User/role/consent changes (`tenant_member.role_change`, `tenant_member.invite`, `consent.update`, `consent.revoke`)
- Sending customer messages (`estimate.send_customer_message`)

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
