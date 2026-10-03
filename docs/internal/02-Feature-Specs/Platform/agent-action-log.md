# Agent action log (AE2)

## Summary

Every agent-originated or agent-proposed action is recorded in `agent_action_logs` with a **trace ID** that correlates to ADR-0015 `audit_logs.request_id` during agent work. OWNER/ADMIN users can inspect traces via the API.

## Data model

- Expand-only table `agent_action_logs` (tenant-scoped, composite `(tenant_id, id)` uniqueness, self-FK for `reverted_by_log_id`).
- `tier` and `status` are **text** columns validated in TypeScript (aligned with AE1 policy tiers; no Postgres tier enum in this ticket).
- `actor_type` uses Postgres enum `AgentActionLogActorType` (`AGENT`, `USER`, `SYSTEM`).

## Trace propagation

- HTTP middleware reads `X-Trace-Id` (generates UUID when absent) and echoes it on responses.
- `AgentActionLogService.record(...)` optionally runs work inside an audit correlation context so Prisma audit rows store the trace ID in `request_id`.
- Non-agent requests keep existing `X-Request-Id` audit behaviour.

## API (`/api/agent-actions`, OWNER/ADMIN)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/agent-actions` | Filters: `traceId`, `agentId`, `status`, `tier`, `entityType`, `entityId`, date range; cursor paging via `cursor` + `limit` |
| GET | `/agent-actions/:traceId` | Log rows for the trace plus correlated audit entries |

No create/update/delete HTTP endpoints — callers use `AgentActionLogService.record(...)`.

## Hygiene

- Summary JSON is redacted (secrets) and size-capped with a truncation marker.

## Testing

- Unit: redaction, append-only service contract, audit correlation helper.
- E2E: trace header, correlated audit join, RBAC, tenant isolation.
- `npm run tenant-restore:verify` includes `agent_action_logs`.
