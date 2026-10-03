# Decision adapter (AE4)

## Summary

A swappable **decision layer** records Jev/OpenRouter suggestions in **shadow mode** next to deterministic outcomes. Suggestions never change production behaviour; AE1 policy rules remain authoritative for agent actions.

## Data rule

**Made-up data only** for provider calls in this phase. Fixtures and shadow `input_redacted_json` use synthetic German examples with obviously fake contact patterns (`@example.org`, invalid VIN-like strings). Nothing real or personal is sent to OpenRouter/Jev. Refer to the pilot deployment as **pilot customer** in docs and code comments — never use a real customer name.

## Architecture

| Piece | Role |
|-------|------|
| `DecisionProvider` | `decide({ useCase, input, choices, context })` → suggestion or `null` |
| `DECISION_PROVIDER` | `noop` (default) or `openrouter-jev` |
| `OpenRouterJevClient` | Single class owning OpenRouter Decisions HTTP details |
| `DecisionShadowService` | Fire-and-forget logging to `decision_shadow_logs` |
| `DecisionUseCaseHooksService` | Import row matching + document sort call sites |

### Use cases (shadow only)

1. **import_row_matching** — after legacy customer import dry-run when duplicate-name warnings fire; compares candidate customer IDs vs deterministic dry-run outcome.
2. **document_sort** — after document branding PDF validation; heuristic classifier is the actual outcome; compares to Jev suggestion.

## Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `DECISION_PROVIDER` | `noop` | Set `openrouter-jev` to enable HTTP client |
| `DECISION_SHADOW_ENABLED` | `false` | When true, schedules shadow writes |
| `OPENROUTER_API_KEY` | empty | GSM secret in deploy; never log or commit |
| `DECISION_OPENROUTER_MODEL` | `typesafe/jev-1.13` | Optional override |
| `DECISION_HTTP_TIMEOUT_MS` | `5000` | Client timeout |

## Swapping models

Implement a new class that satisfies `DecisionProvider` and extend `createDecisionProvider()` (for example a future self-hosted Laya/Von endpoint on Cloud Run EU). Keep vendor-specific request/response mapping inside one client file per vendor.

## Evaluation

- Labelled JSONL fixtures: `apps/core-api/test/fixtures/agent-eval/labeled-examples.jsonl` (~200 examples).
- Local eval: `pnpm agent-eval` (requires provider key; not run in CI by default).
- Hygiene test rejects `sk-` patterns and non-reserved email domains in fixtures.

## Operations

- Expand-only table `decision_shadow_logs` with composite `(tenant_id, id)` and tenant FK.
- Included in `npm run tenant-restore:verify`.
- Trace IDs reuse AE2 `X-Trace-Id` when present.
