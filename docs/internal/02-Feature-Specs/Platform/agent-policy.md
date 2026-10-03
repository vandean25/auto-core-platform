# Agent policy (AUT-393)

Deterministic autonomy tiers for future agent actions. The policy evaluator is the final authority: model suggestions may only make outcomes stricter, never looser.

## Tiers

| Tier | Meaning | Examples |
| --- | --- | --- |
| `AUTO` | Agent may execute alone; reversible, low risk, logged | Read workshop order, add line under threshold, reserve part |
| `PROPOSE` | Agent prepares; human one-click approval | Discounts, customer-facing messages, import apply |
| `HUMAN_ONLY` | Agents must not execute | Invoice finalize, credit notes, tax/VAT wording, accounting export, deletions, role/consent changes |

## Rules storage

- **Platform defaults** (`tenant_id` null) are seeded in migrations.
- **Tenant overrides** create a new `version` per `action_type` and may only set a tier **at least as strict** as the platform default (enforced in API and DB trigger).
- **Conditions** (`conditions_json`): `amount_max` (EUR), `customer_facing`, `reversible`, `affects_legal_document`. Customer-facing actions or amounts above `amount_max` escalate to at least `PROPOSE`.

## Hard floors

Regardless of table content, actions in these categories evaluate to `HUMAN_ONLY`: invoice finalize, credit note, tax/VAT wording, accounting export, deletion, user/role changes, consent changes. Unknown action types fail closed to `HUMAN_ONLY`.

## API (OWNER/ADMIN)

- `GET /api/agent-policy/rules` — effective rules for the tenant
- `PUT /api/agent-policy/rules/:actionType` — new tenant rule version (audited)
- `POST /api/agent-policy/evaluate` — dry-run evaluation
