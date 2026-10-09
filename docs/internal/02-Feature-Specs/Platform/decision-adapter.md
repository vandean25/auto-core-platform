# Decision adapter (AE4, live-apply AUT-413)

## Summary

A swappable **decision layer** records Jev/OpenRouter suggestions next to deterministic outcomes. By default it runs in **shadow mode**: suggestions are logged to `decision_shadow_logs` and never change production behaviour.

AUT-413 adds an opt-in **live-apply** mode. Live mode awaits Jev only where the rules leave a gap. Each suggestion is then applied, proposed for approval, or refused according to its policy tier. Deterministic rules stay final, and AE1 policy rules remain authoritative for agent actions.

## Data rule

**Made-up data only** for provider calls in this phase. Fixtures and shadow `input_redacted_json` use synthetic German examples with obviously fake contact patterns (`@example.org`, invalid VIN-like strings). Nothing real or personal is sent to OpenRouter/Jev. Refer to the pilot deployment as **pilot customer** in docs and code comments, never by a real customer name.

## Architecture

| Piece | Role |
|-------|------|
| `DecisionProvider` | `decide({ useCase, input, choices, context })` → suggestion or `null` |
| `DECISION_PROVIDER` | `noop` (default) or `openrouter-jev` |
| `OpenRouterJevClient` | Single class owning OpenRouter Decisions HTTP details |
| `DecisionShadowService` | Fire-and-forget logging to `decision_shadow_logs`; `writeShadowRecord` is reused by live mode |
| `DecisionUseCaseHooksService` | Import row matching and document sort call sites; builds the redacted cases |
| `DecisionLiveApplyService` (AUT-413) | Mode resolution, bounded Jev call, choice validation, tier dispatch, audit |
| `decision-live-apply.util.ts` (AUT-413) | Shared writes for an import-row match and a document type, used by live AUTO **and** by approval |
| `AgentPolicyService`, `AgentProposalService`, `AgentActionLogService` | Tier evaluation, pending approvals (AUT-404 path), audit rows |

### Use cases

1. **import_row_matching**: after a legacy customer import dry-run, for rows with an `IMPORT_POSSIBLE_DUPLICATE` warning only. Shadow compares Jev with the deterministic dry-run outcome. Live may adopt an existing customer match.
2. **document_sort**: after document branding PDF validation. The heuristic classifier is final unless it returns `Sonstiges`. Only that gap is sent to Jev.

## Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `DECISION_PROVIDER` | `noop` | Set `openrouter-jev` to enable the HTTP client |
| `DECISION_SHADOW_ENABLED` | `false` | When true, writes `decision_shadow_logs`. In live mode the same suggestion is reused, so Jev is never called twice for one decision |
| `DECISION_APPLY_MODE` | `shadow` | AUT-413. `live` allows live-apply. Any other value, including typos, means `shadow` |
| `DECISION_LIVE_OPT_IN` | unset | AUT-413 production gate. Must be `true` for live in a `NODE_ENV=production` runtime. See [Production gate](#production-gate) |
| `OPENROUTER_API_KEY` | empty | GSM secret in deploy; never log or commit |
| `DECISION_OPENROUTER_MODEL` | `typesafe/jev-1.13` | Optional override |
| `DECISION_HTTP_TIMEOUT_MS` | `5000` | Per-call timeout. A live import batch is also bounded to 2× this value in total |

### Tenant override

`tenants.decision_apply_mode` (nullable, AUT-413). The value `shadow` opts that tenant out of live-apply. NULL inherits the environment.

The column cannot turn live on. Where the environment says shadow, every tenant is shadow. The environment is checked first, so shadow deployments never read the tenant row. A failed tenant lookup also resolves to shadow.

There is no tenant-facing API for this column yet. Set it with SQL (see the [QA runbook](../../05-Runbooks/decision-live-apply-qa-switch-on.md)).

## Live-apply (AUT-413)

### Policy tiers

Live suggestions are evaluated with `AgentPolicyService.evaluateAction`. Platform default rows come from migration `20261009120000_aut413_decision_live_apply`.

| Action type | Platform default | Entity |
|-------------|------------------|--------|
| `decision.import_row_match` | `PROPOSE` | `ImportJob` (row-level detail in the log) |
| `decision.document_sort` | `PROPOSE` | `DocumentBrandAsset` |

Tenant rules must be at least as strict as the latest platform row. A DB trigger enforces this (AUT-393). A tenant can therefore move to `HUMAN_ONLY`, but cannot move to `AUTO` by itself. **AUTO is platform-owned.**

| Tier | Import match | Document sort |
|------|--------------|---------------|
| `AUTO` | The dry-run row changes from CREATE to UPDATE with the matched customer id. The user still confirms the import in the existing flow. | Sets `document_sort_type` on the READY asset, only while it is unset. |
| `PROPOSE` | Nothing changes. A pending approval is created (AUT-404) and appears in Approvals. Approving applies the same write as AUTO. | Nothing changes. A pending approval is created. Approving sets the type. |
| `HUMAN_ONLY` | Nothing changes. The suggestion is logged as `REFUSED`. | Same as import. |

### What Jev can and cannot do

- Jev never overrides a deterministic decision.
  - **Import:** only a CREATE row can adopt an existing customer. `create_new` on a CREATE row, same-file candidates, and rows the rules already matched keep the rules outcome.
  - **Document sort:** only the `Sonstiges` gap is consulted.
- The choice must be in the allowed list (`choice_N` / `create_new` for import; the five document types for doc sort). Anything else is `invalid_choice` and is not applied.
- Input is redacted before it leaves the process. Names, emails, phones, VAT ids and addresses are replaced by hashed match features, and candidates are sent as `choice_N` aliases (`redactShadowParams`, unchanged from AE4).

### Fallback

A timeout, provider error, empty answer, invalid choice, exhausted batch budget, or unexpected error keeps the rules outcome. The user's request is never failed by Jev. Each fallback is still audited.

### Audit

Every live decision writes one `agent_action_logs` row. It carries the request trace id, the tier, the redacted input and suggestion, and the outcome.

With `DECISION_SHADOW_ENABLED=true`, a live decision also writes its `decision_shadow_logs` row from the same suggestion. Documents the heuristic already classified (not `Sonstiges`) never reach live, so they keep the ordinary shadow row. The AE7 comparison data therefore stays complete in live mode.

| Outcome | `status` | Meaning |
|---------|----------|---------|
| `applied` | `EXECUTED` | AUTO applied the suggestion |
| `proposed` | `PROPOSED` | A pending approval exists |
| `refused` | `REFUSED` | HUMAN_ONLY: logged only |
| `fallback` | `FALLBACK` | Rules outcome kept. The reason is in `result_summary_json.reason` |

Approving a PROPOSE action writes an `EXECUTED` row through the AUT-404 path. Logs and proposal payloads hold ids and enums only. They never contain names, emails, phones, VAT ids, addresses, or provider rationale.

### Production gate

A `NODE_ENV=production` runtime stays in shadow unless `DECISION_LIVE_OPT_IN=true`. Every Cloud Run service runs with `NODE_ENV=production` (`cloudbuild*.yaml`), so QA needs the opt-in as well. **Do not set `DECISION_LIVE_OPT_IN` in production until AUT-395 passes.** The variables are not set in any `cloudbuild*.yaml` or `infra/` file. Infra sets them on QA only.

### Evaluation gate (AE4)

[agent-eval-jev-vs-rules.md](./agent-eval-jev-vs-rules.md) concludes that no configuration passes the human-facing gate. It recommends keeping import matching rules-only and showing no Jev suggestion to a person until the gate passes. Live-apply is therefore an **evaluation switch for QA**, not a production setting. `PROPOSE` shows suggestions to a human, which is the case that gate covers. Revisit the platform defaults once the gate passes.

## Swapping models

Implement a new class that satisfies `DecisionProvider` and extend `createDecisionProvider()` (for example a future self-hosted Laya/Von endpoint on Cloud Run EU). Keep vendor-specific request/response mapping inside one client file per vendor.

## Evaluation

- Labelled JSONL fixtures: `apps/core-api/test/fixtures/agent-eval/labeled-examples.jsonl` (~200 examples).
- Local eval: `pnpm agent-eval` (requires provider key; not run in CI by default).
- Hygiene test rejects `sk-` patterns and non-reserved email domains in fixtures.
- Live-apply tests use a fake provider only (`test/decision-live-apply.e2e-spec.ts`). They never call OpenRouter.

## Read API (AUT-423)

QA can read shadow rows without raw database access: `GET /api/decision-shadow-logs`. Read-only, so no endpoint applies, edits or deletes a suggestion. Live-apply is out of scope here (AUT-413).

| Topic | Rule |
|-------|------|
| Roles | OWNER, ADMIN, ADVISOR (same supervisor gate as `/api/agent-actions`). TECH and SALES get 403. |
| Scope | Tenant-scoped through `TenantContextService`. Rows from other tenants are never returned. |
| Filters | `useCase` (`import_row_matching` \| `document_sort`); `startDate` / `endDate` on `created_at` (ISO-8601; a date-only `endDate` includes the whole UTC day); `startDate` must not be after `endDate`. |
| Paging | `limit` (1-100, default 20) and opaque `cursor`. Newest first. Response is `{ data, nextCursor }`. |
| Row fields | `id`, `traceId`, `useCase`, `suggestion` (`choice`, `confidence`, `rationale`, or null), `actualOutcome` (`choice`, `source`, or null), `latencyMs`, `error` (provider error text, null on success), `provider`, `model`, `match`, `createdAt`. |
| Not exposed | `input_redacted_json`, `input_hash`, provider `raw_ref`, token counts. |

Code: `apps/core-api/src/decision-shadow-log/`. Contract: `openapi/openapi.json` and the generated web types.

UI: the **Decision shadow** tab on Agent Supervision (`/agent/supervision`). It has the same visibility as that page (`isAgentSupervisionEnabled()` and OWNER/ADMIN/ADVISOR). Filters apply on change and there is no Apply button.

## Operations

- Expand-only schema changes:
  - `decision_shadow_logs` (AE4): composite `(tenant_id, id)` and tenant FK.
  - `tenants.decision_apply_mode` (AUT-413): nullable, CHECK allows only `shadow`.
  - `document_brand_assets.document_sort_type` (AUT-413): nullable, CHECK limits it to the five document types.
  - Platform `agent_policy_rules` rows for `decision.import_row_match` and `decision.document_sort` (`PROPOSE`, enabled).
- Trace IDs reuse the AE2 `X-Trace-Id` when present. Live rows look up at `/api/agent-actions/:traceId`.
- Live import adds at most about 2× `DECISION_HTTP_TIMEOUT_MS` to a dry-run request, and only when live is on.
- Test database hygiene: the e2e suites assume a fresh, unseeded database, as in CI.
