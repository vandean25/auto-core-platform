---
title: "ADR-0027: Sentry Spans and App Trace ID Linkage Without a Schema Change"
date: "2026-10-11"
status: accepted
deciders: ""
linear-project: ""
linear-milestone: ""
tags:
  - adr
  - observability
---

# ADR-0027: Sentry Spans and App Trace ID Linkage Without a Schema Change

## Status

**Accepted** — 2026-10-11

## Context

Requests already carry an app-level trace id: `TenantContextMiddleware` reads `x-trace-id` (a UUID) or generates one, and the same value is persisted as `AgentActionLog.trace_id` and `AuditLog.request_id` (ADR-0015). Sentry separately traces each request with its own 128-bit trace id, and the two were not connected.

Support needs to move both ways: from an agent action row to the Sentry trace that produced it, and from a Sentry error or transaction to the app trace id that the action log and audit reads use. Invoice finalization, document-branding extraction and agent actions also needed spans. The branding flow runs in a Cloud Tasks worker, so its span has to join the request trace across that hop.

## Decision

1. **One span helper.** `apps/core-api/src/common/observability/trace.ts` wraps `Sentry.startSpan`. Without an initialised Sentry client it calls the function directly, so local runs and tests behave as before. Attributes pass a filter: finite numbers, booleans and strings of at most 200 characters are kept. Objects, arrays, null and keys that name personal data or content (`email`, `name`, `prompt`, `text`, and similar) are dropped.
2. **The app trace id is the join key, and it stays where it is.** No column is added and no migration runs. Two links carry it into Sentry:
   - `TenantContextMiddleware` tags the request's isolation scope with `app.trace_id`, so events and transactions of that request carry it.
   - `AgentActionLogService.record` writes `agent.trace_id` onto the active span, and the `agent.action` span carries it too.
   Searching Sentry for `app.trace_id:<uuid>` or `agent.trace_id:<uuid>` finds the request, and the action log row has the same uuid.
3. **The Sentry trace id is not persisted.** `getActiveTraceId()` returns it for log correlation. It is not written to Postgres.
4. **Cross-hop propagation is observability only.** Cloud Tasks requests for PDF generation, branding extraction and branding validation carry `sentry-trace` and `baggage` headers. These headers are not part of the signed task payload. The existing `x-trace-id` forwarding for branding validation is unchanged. New task types do not forward `x-trace-id`, because that would change the correlation ids persisted by worker writes.
5. **Inbound propagation is already handled.** `main.ts` imports `instrument.js` first, so the Sentry HTTP integration continues incoming `sentry-trace` and `baggage` headers. `enableCors` in `common/http/http-security.ts` sets an origin list without an `allowedHeaders` list, so the browser's trace headers are not blocked.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Add a `sentry_trace_id` column to `agent_action_logs` | Direct lookup from a row to its Sentry trace | Needs a Prisma migration on a high-volume audit table. The reverse lookup is already available through the tag. Rejected |
| Derive the app trace id from the Sentry trace id | No storage and no migration | Browser pageloads share one Sentry trace across requests, so unrelated actions would share one app trace id. Changes the generation semantics. Rejected |
| Store the Sentry trace id inside `input_summary_json` or `result_summary_json` | No migration | Changes persisted audit payloads and the MCP output shape. Rejected |
| Chosen: tag the app trace id on Sentry and attach it to spans | No migration, no persisted change, both directions searchable | Sentry transactions exist only for sampled traces (see Consequences) |

## Consequences

### Positive

- No Prisma migration and no change to persisted audit data or API responses.
- Both directions are searchable: an action log row to Sentry, and a Sentry event to the action log.
- Invoice PDF hand-off, PDF generation and branding extraction join one trace across Cloud Tasks.
- Production sampling is unchanged at `SENTRY_TRACES_SAMPLE_RATE=0.1`.

### Negative

- Sentry transactions and spans exist only for sampled traces. At the production rate of 0.1, most requests have no span to search. Error events still carry `app.trace_id`, because they are not sampled.
- Sentry retention limits how far back the reverse lookup works.

### Neutral

- QA sets `SENTRY_TRACES_SAMPLE_RATE=1` and `VITE_SENTRY_TRACES_SAMPLE_RATE=1` (see `docs/sentry-tracing.md`).
- Import spans (`import.parse`, `import.validate`, `import.commit`) are deferred to a follow-up PR. The AUT-449 split of `import.service.ts` has merged, so that PR can add them.

## References

- [ADR-0015: Audit Tracing and Operational Logging](2026-05-26-audit-tracing-and-operational-logging.md)
- [ADR-0007: Asynchronous PDF Generation Pipeline](2026-04-12-async-pdf-pipeline.md)
- `docs/sentry-tracing.md` (span catalogue, attribute rules, QA sampling)
- `apps/core-api/src/common/observability/trace.ts`
- Linear: AUT-452

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | auto-core-platform |
| Milestone | Observability |
| Issues | AUT-452 |
