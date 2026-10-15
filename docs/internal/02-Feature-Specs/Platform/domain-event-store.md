# Domain event store (AUT-536)

Transactional occurrence log for agent orchestration. Not a replacement for the notification outbox or dashboard WebSocket realtime. Domain events are **not** pushed on the dashboard WebSocket allowlist; agents consume them via `GET /api/agent/domain-events` (poll/resume with cursor).

## Event types (v1)

| `event_type` | When written | `entity_id` | Payload |
| --- | --- | --- | --- |
| `workshop_order.scheduled.v1` | Workshop order created with `SCHEDULED` status and a bay window | Workshop order id | Empty object |
| `workshop_estimate.decided.v1` | Estimate approval evidence committed (public link or advisor) | Workshop order id | `estimate_version_id`, `decision` (`APPROVED` / `DECLINED`) |

Envelope fields on every row: `event_id`, `event_type`, `schema_version`, `tenant_id`, `site_id`, `entity_id`, `occurred_at`, `trace_id`, plus monotonic `sequence` for feed ordering.

Public KVA approval tokens never appear in events or logs. For link approvals, `site_id` comes from the estimate document (`workshop_estimates.site_id`), not the advisor site switcher.

## Feed

- `GET /api/agent/domain-events` — OWNER/ADMIN only; sites filtered to active authorized memberships.
- Pagination: `pageSize` (max 25), opaque `cursor` from `meta.next_cursor` (cursor version 1: `{ v, seq, id }`).
- Invalid or foreign-tenant cursors return `400` without exposing other tenants' data or counts.

## Retention and purge

Append-only at the API layer. Tenant purge deletes `domain_events` with the tenant. See `docs/deletion-policy.md` (AUT-536 section).
