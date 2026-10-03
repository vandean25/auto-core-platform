# MCP server (AE5) — phase 1 read-only tools

## Summary

Exposes Auto Core Platform data to MCP clients over **Streamable HTTP** at `/api/mcp`, authenticated with the same Firebase/JWT session as the REST API. Every tool call is recorded in `agent_action_logs` (AE2) with tier **AUTO** and a trace ID from `X-Trace-Id`.

Phase 1 is **read-only** only. Draft/reserve/write tools and policy evaluation for writes are phase 2.

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

## Tools (phase 1)

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

## Agent identity

`agent_id` is `mcp:<clientInfo.name>` from the MCP `initialize` request (e.g. `mcp:cursor`).

## Local MCP client

1. Start API with `MCP_SERVER_ENABLED=true` and a normal dev `.env`.
2. Sign in via the web app (or use a test JWT in `NODE_ENV=test`).
3. Point an MCP client at Streamable HTTP URL `http://127.0.0.1:3000/api/mcp` with header `Authorization: Bearer <token>`.
4. Optional: pass `X-Trace-Id: <uuid>` to correlate with `GET /api/agent-actions/:traceId`.

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

`draft_workshop_order`, `reserve_part`, `propose_line_item`, OAuth dynamic client registration, public hardening, destructive tools, deploy.
