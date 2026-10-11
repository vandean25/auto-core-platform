# Sentry tracing in core-api and core-web

This page covers what is traced, which attributes may be recorded, how QA turns sampling up, and how to find an app trace id in Sentry. The linkage decision is in [ADR-0027](internal/01-ADR/2026-10-11-sentry-app-trace-linkage.md).

## Sampling

| Setting | Where it is read | Production default | QA / local |
|---|---|---|---|
| `SENTRY_TRACES_SAMPLE_RATE` | `apps/core-api/src/instrument.ts` | `0.1` | `1` |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | `apps/core-web/src/sentry/config.ts` | `0.1` (production builds) | `1` |
| `SENTRY_ENVIRONMENT` | `instrument.ts`; falls back to `NODE_ENV` | set per deploy | `qa` or your local name |
| `VITE_SENTRY_ENVIRONMENT` | `config.ts`; falls back to the Vite mode | set per deploy | `qa` or your local name |

To record every trace in a local QA run, set both sample rates to `1`:

```bash
# apps/core-api/.env
SENTRY_TRACES_SAMPLE_RATE=1

# apps/core-web/.env.local
VITE_SENTRY_TRACES_SAMPLE_RATE=1
```

Production keeps `0.1`. The defaults in `instrument.ts` and `config.ts` are unchanged. `cloudbuild.yaml` already sets QA values as substitution defaults. This page does not change them.

## Spans

Names and ops are stable, so dashboards and saved searches can rely on them.

| Span name | op | Recorded by | Attributes (besides Sentry's own) |
|---|---|---|---|
| Finalize invoice | `invoice.finalize` | `sales/invoice-finalization.service.ts` (inside the caller's transaction) | `invoiceId`, `step` (last step reached), `outcome` (`finalized`, `rejected`, `failed`) |
| Enqueue invoice PDF | `invoice.pdf.enqueue` | `invoices/invoice-pdf.service.ts`, `requestGeneration` | `invoiceId`, `outcome` (`enqueued` or `generated`). Children: `cloudtasks.enqueue`, or `pdf.generate` for the inline fallback |
| Extract document branding | `branding.extract` | `document-branding/document-branding-extraction-worker.service.ts`, one per claimed attempt | `asset_id`, `provider`, `model_id`, `status` (`published`, `not_published`, `retry`, `failed`, `skipped`), `failure_code`, `byte_size_bucket`, `duration_ms` |
| Parse document branding source | `branding.extract.parse` | same worker, around PDF validation and rasterizing | `source_kind` (`pdf` or `image`), `byte_size_bucket`, `status` |
| Extract branding with provider | `branding.extract.provider` | same worker, around the provider call | `provider`, `model_id`, `status` |
| Agent action | `agent.action` | `mcp/mcp-write-pipeline.service.ts`, one per write call | `agent.action.type`, `agent.policy.tier`, `agent.trace_id` |
| Evaluate agent policy | `agent.policy.evaluate` | `agent-policy/agent-policy.evaluator.ts` | `agent.policy.tier`, `agent.policy.outcome` (`allowed`, `proposed`, `refused`). The action type is not recorded here; the `agent.action` span carries the trusted tool name. This span also runs, without an `agent.action` parent, when the MCP capability listing or `POST /agent-policy/evaluate` evaluates a policy |
| Agent decision | `agent.decision` | MCP pipeline branch (refuse, propose or execute), and each provider call in `decision/decision-provider-span.ts` | MCP: `agent.policy.outcome`. Provider: `agent.decision.provider`, `agent.decision.use_case`, `agent.decision.choice_count`, `agent.decision.outcome` (`suggested` or `none`) |

Existing spans are unchanged: `cloudtasks.enqueue`, `pdf.generate`, and the PDF renderer spans.

### Import spans

`import.parse`, `import.validate` and `import.commit` are not in this change. `import/import.service.ts` is being split under AUT-449, so those spans follow in a separate PR after that split merges.

## Attribute rules

Attributes leave the process for Sentry. Write only identifiers, enums and sizes.

- Record ids such as `invoiceId`, `asset_id`, `agent.trace_id`, and the enum values in the table above.
- Record byte sizes as buckets through `toByteSizeBucket`. The buckets are `lt_100kb`, `100kb_1mb`, `1mb_5mb`, `5mb_10mb` and `gte_10mb`. Exact sizes are not recorded.
- Never record document bytes, extracted text, prompts, provider replies, customer names, email addresses, phone numbers, or bank details.
- Sentry marks a span as an error whenever its callback throws. That includes expected 4xx rejections (missing source, not found, conflict) and agent policy refusals. The error status alone does not mean a system failure. For invoice finalization, `outcome` is `rejected` for a 4xx business rejection and `failed` otherwise. For agent decisions, `agent.policy.outcome` is `refused` for a policy refusal.
- Use `withSpan`, `withStatusSpan` and `setActiveSpanAttributes` from `common/observability/trace.ts`. They drop non-primitive values and keys that name personal data or content, and they cut strings to 200 characters. They do nothing when Sentry has no client.

## Linking an app trace id to Sentry

- Every request tags its Sentry isolation scope with `app.trace_id` (`TenantContextMiddleware`). Events and transactions carry it.
- `agent.action` spans and the active span of `AgentActionLogService.record` carry `agent.trace_id`. The value is the same uuid as `AgentActionLog.trace_id`.
- To find the Sentry trace for an action row, search Sentry for `agent.trace_id:<uuid>` or `app.trace_id:<uuid>`. To find the action rows for a Sentry event, read its `app.trace_id` tag and use `GET /api/agent-actions/:traceId`.
- Sentry transactions exist only for sampled traces. Error events are always captured, so an error can be linked even when its trace was not sampled.

Cloud Tasks requests for PDF generation, branding extraction and branding validation include `sentry-trace` and `baggage` headers, so the worker's span joins the request's Sentry trace. These headers are not part of the signed payload.

## Inbound propagation

No change was needed for browser or client requests. `main.ts` imports `instrument.js` before anything else, so the Sentry HTTP integration reads incoming `sentry-trace` and `baggage` headers. `enableCors` does not restrict `allowedHeaders`, so those headers reach the server from the browser.
