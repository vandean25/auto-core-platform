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
| `get_customer` | AUTO | Customer detail by id |
| `search_vehicles` | AUTO | Paged vehicle search |
| `get_vehicle` | AUTO | Vehicle detail by id |
| `list_workshop_orders` | AUTO | Paged workshop orders (active site) |
| `get_workshop_order` | AUTO | Workshop order by id (active site) |
| `search_parts` | AUTO | Inventory search; optional `workshop_order_id` uses workshop catalog search |
| `get_stock_level` | AUTO | Stock for `sku` or `catalog_item_id` (active site) |

Outputs are page-limited (max 25 rows) and JSON size-capped before returning to the client. Summaries written to the action log are redacted per AE2.

## Write tools (phase 2)

| Tool | Default Tier | Reversibility | Counter-tool |
|------|--------------|---------------|--------------|
| `draft_workshop_order` | Off by default; AUTO when enabled | Reversible through the workshop order cancellation workflow | Manual workshop order cancellation |
| `reserve_part` | Off by default; AUTO up to the policy amount limit, otherwise PROPOSE | Reversible via `release_reservation` | `release_reservation` |
| `release_reservation` | Off by default; AUTO when enabled | Reversible via `reserve_part` (subject to stock availability) | `reserve_part` |
| `propose_line_item` | Off by default; PROPOSE when enabled | Preview only; the proposed line item is rolled back and not persisted | Not applicable |

Write tools follow a shared pipeline: policy evaluation → immediate refusal for disabled / HUMAN_ONLY actions → DryRunService rollback preview (`would_change`) for enabled actions → outcome by evaluated tier:
- **AUTO**: Execute immediately, log as EXECUTED
- **PROPOSE**: Requires human approval, log as PROPOSED
- **HUMAN_ONLY**: Return `not_permitted` (HTTP 403) without preview or execution, log as REFUSED

Note: `propose_line_item` is hard-clamped to PROPOSE tier and cannot be loosened to AUTO. All MCP write rules start disabled in the platform policy table; a tenant admin must enable each rule before the write can proceed. Disabled rules fail closed with `not_permitted` (HTTP 403). The MCP write schemas do not accept a `dry_run` argument. Enabled AUTO calls proceed to execution after the internal preview; PROPOSE calls return `needs_approval` with a pending action ID and do not execute the proposed action. Tenant policy can be stricter than the platform floor, never looser.

## Never-exposed actions

The following actions are intentionally never exposed as MCP tools, as they require human oversight or are withheld from agent automation per policy:

- Invoice finalization (`invoice.finalize`)
- Credit note issuance and finalization (`credit_note.issue`, `credit_note.finalize`)
- Accounting exports (`accounting_export.create`, `accounting_export.submit`)
- Deletions of customers, vehicles, or workshop orders
- User/role/consent changes (`tenant_member.role_change`, `tenant_member.invite`, `consent.update`, `consent.revoke`)
- Sending customer messages (`estimate.send_customer_message`)

These align with the `MCP_NEVER_EXPOSED_ACTIONS` constant in the MCP implementation.

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

- Unit: Zod tool schemas, MCP RBAC helper.
- E2E: `apps/core-api/test/mcp.e2e-spec.ts` (flag off, RBAC, tool list, action log row, tenant isolation).

## Out of scope (phase 2)

OAuth dynamic client registration, public hardening, destructive tools, deploy.
