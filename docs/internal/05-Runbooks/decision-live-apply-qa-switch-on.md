# QA switch-on: decision live-apply

Linear: [AUT-413](https://linear.app/auto-core-platform/issue/AUT-413)
Spec: [decision-adapter](../02-Feature-Specs/Platform/decision-adapter.md)

## Scope

This runbook switches **QA only**. Production stays in shadow. Do not set these variables in production until AUT-395 passes. Use synthetic data for any import that reaches Jev. Refer to the pilot as **pilot customer**.

## Before you start

- Migration `20261009120000_aut413_decision_live_apply` is applied to the QA database (`prisma migrate deploy`). It is expand-only.
- The QA service has a provider configured: `DECISION_PROVIDER=openrouter-jev` and `OPENROUTER_API_KEY` from Google Secret Manager. Never paste the key into tickets, logs or chat.

## Environment variables (QA Cloud Run service only)

| Variable | Value | Required | Purpose |
|----------|-------|----------|---------|
| `DECISION_APPLY_MODE` | `live` | Yes | Allows live-apply. Any other value keeps shadow |
| `DECISION_LIVE_OPT_IN` | `true` | Yes on QA | QA runs with `NODE_ENV=production`, so live needs this production gate |
| `DECISION_PROVIDER` | `openrouter-jev` | Yes | Enables the Jev client |
| `OPENROUTER_API_KEY` | GSM secret reference | Yes | Secret. Do not print it |
| `DECISION_SHADOW_ENABLED` | `true` | Optional | Also writes `decision_shadow_logs` for the AE7 eval |
| `DECISION_HTTP_TIMEOUT_MS` | e.g. `5000` | Optional | Per-call timeout. Default 5000 |
| `DECISION_OPENROUTER_MODEL` | model id | Optional | Default `typesafe/jev-1.13` |

Infra sets these on the QA service after this PR merges. They are deliberately not in `cloudbuild*.yaml` or `infra/`. Nothing in the repo turns live on.

## Platform tiers on QA

| Action type | Tier | Result |
|-------------|------|--------|
| `decision.import_row_match` | `PROPOSE` | Suggestion becomes a pending approval in Approvals |
| `decision.document_sort` | `PROPOSE` | Suggestion becomes a pending approval in Approvals |

A tenant policy rule can only be stricter than the platform row. It can set `HUMAN_ONLY`, but it cannot set `AUTO` (AUT-393 trigger). **AUTO is platform-owned.** To exercise AUTO on QA, insert a platform row (`tenant_id` NULL, higher `version`, tier `AUTO`) in the QA database only, with product sign-off. Never do this in production.

## Verify on QA

1. Import a customer CSV with one row whose name matches an existing customer (this triggers `IMPORT_POSSIBLE_DUPLICATE`). Send an `X-Trace-Id` header with a fresh UUID.
2. Look up the audit rows at `/api/agent-actions/<traceId>` as a tenant admin. Expect one `decision.import_row_match` row with tier `PROPOSE` and status `PROPOSED`. Status `FALLBACK` means Jev did not answer usefully; `result_summary_json.reason` says why.
3. In Approvals, a `PENDING` proposal for `decision.import_row_match` should exist. Approving it changes the dry-run row to UPDATE and updates the job totals. Nothing changes until a person also confirms the import.

## Roll back

- **Whole environment:** set `DECISION_APPLY_MODE=shadow` (or remove it) on the QA service. The next revision serves shadow. Matches already approved stay as they are. Pending proposals stay `PENDING` and expire after 7 days.
- **One tenant:** `UPDATE tenants SET decision_apply_mode = 'shadow' WHERE id = '<tenant id>';` takes effect on the next request. Reset with `SET decision_apply_mode = NULL`.

## Known limits

- Jev suggestions reach people only as PROPOSE items. The AE4 human-facing gate is not yet passed (see the decision spec), so testers should not treat a suggestion as correct.
- A live import dry-run can take up to about 2× `DECISION_HTTP_TIMEOUT_MS` longer.
- An approved document type is stored on the branding asset (`document_sort_type`). Nothing reads it yet.
