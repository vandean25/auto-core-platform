# Tyre measurement (Reifenmessung)

## Summary

AUT-802 T1: approved backend contract for append-only tyre evidence on workshop orders and reception check-ins. Store raw wheel readings and the evaluation made at capture; never recompute historical reads. Tyre-hotel event reads are included, but hotel writes, backfill, UI and uploads belong to later T2/T3 work.

## User Stories

- Workshop desk staff and technicians record tyre condition, then read the same evidence even after settings, vehicle data or author membership changes.

## Database Impact

- Add `TyreMeasurement` and child `TyreWheelReading` tables through an additive migration. Persist tenant/site scope, parent and vehicle bindings, capture time, country, weight class and its provenance. Enforce distinct positions per measurement and index scoped parent-history reads.
- Store raw per-wheel tread inner/middle/outer values, season, construction, winter marking and DOT relationally, not only in a JSON payload. At most five distinct positions: `FL`, `FR`, `RL`, `RR`, `SPARE`. Each tread value is finite and within **0–20 mm**, inclusive; the lowest of the three decides. Mixed tyres are evaluated independently.
- Freeze each wheel's evaluation snapshot at capture: `version: 1`, `rulesVersion: AT_DE_2026_10`, country, evaluation time, weight class, minimum tread, resolved thresholds, parsed DOT, state, status and reason codes. Persist readings and snapshots atomically. Later settings changes do not alter them.
- `measured_by` is a nullable FK to `User` with `ON DELETE SET NULL`, alongside an immutable author display snapshot. There is **no `TenantMember` FK**; membership removal must not destroy attribution.
- Evidence parents and referenced media use restrictive FKs, not cascading deletion. Existing retarget helpers remain unchanged: composite FK restrictions alone prevent changes that would invalidate evidence bindings; no automatic retargeting of measurements.
- No new workflow state machine, stock movements, fiscal records or sequential numbering. Deletion rules are in [Entity Deletion Policy](../../../deletion-policy.md#aut-802--tyre-measurement-evidence).

### Capture context and photos

- Resolve tenant/site through authenticated context and validate every parent/media reference within that scope. Derive the document's site from its parent and require it to match the active site; recheck site activity when creating.
- Capture `country` from the site's `LegalEntity`, never from a request default. The current shared fiscal schema permits only `AT`/`DE`; this feature does not expand it. The capture payload supports other countries (tested with `ES`): valid facts retain state/reason `UNSUPPORTED_COUNTRY` and **null status and thresholds**, without an Austrian fallback. This path becomes reachable through the API when legal entities support those countries.
- `Vehicle` has no authoritative permissible gross-weight field. Never infer this class from kerb mass or a vehicle name. Explicit `weightClass` is `UP_TO_3500_KG` or `OVER_3500_KG`, with provenance `CAPTURE`; omission uses `UP_TO_3500_KG` with provenance `DEFAULT`.
- Optional wheel photos reference only existing **image** `WorkshopMedia` with purpose `CHECK_IN`, attached to the matching check-in and workshop order in the same tenant/site. Reject signatures, videos, unattached media and mismatched parents. An order without a check-in has no photo support. Hotel photo support is deferred to T2; T1 adds no upload route.

## API Contract Changes

| Method | Route | Purpose |
|---|---|---|
| POST / GET | `/api/workshop-orders/:id/tyre-measurements` | Append evidence / list order history |
| POST / GET | `/api/workshop-check-ins/:id/tyre-measurements` | Append evidence / list check-in history |
| GET only | `/api/tyre-set-events/:id/tyre-measurements` | Read event-linked evidence; no hotel write route |
| GET only | `/api/tyre-measurements/:id` | Read one stored measurement with readings and snapshots |

All measurement reads and creates allow `OWNER`, `ADMIN`, `SALES`, `TECH`, with active tenant/site authorization, including nested reads. Creates accept wheel facts, optional weight class and eligible existing media references; parent bindings, actor, country and evaluation come from the server. Lists use `{ data, meta }`. No PATCH, PUT or DELETE measurement API; corrections are new measurements, not edits.

Existing `GET/PUT /api/tyre-sets/settings` exposes `recommendationOverrides` backed by `TyreStorageSettings.recommendation_overrides`. Settings retain existing permissions: `OWNER`/`ADMIN`/`SALES` can update; existing REST settings routes remain unavailable to `TECH`. Measurement routes explicitly allow `TECH`.

Both contract artifacts are regenerated with the backend changes:

- `npm --prefix apps/core-api run openapi:generate`
- `npm --prefix apps/core-web run api:types:generate`

## Evaluation rules

`ALL_SEASON` uses the winter profile and winter age recommendation. Austrian winter construction defaults to `RADIAL` when omitted. German profiles do not vary by weight or construction. Values below are in millimetres.

| Profile | Ordinary minimum | Legal/profile minimum | Recommend below (default) |
|---|---:|---:|---:|
| `AT_SUMMER_LIGHT` | 1.6 | 1.6 | 3 |
| `AT_SUMMER_HEAVY` | 2 | 2 | 3 |
| `AT_WINTER_LIGHT_RADIAL` | 1.6 | 4 | 5 |
| `AT_WINTER_LIGHT_DIAGONAL` | 1.6 | 5 | 6 |
| `AT_WINTER_HEAVY_RADIAL` | 2 | 5 | 6 |
| `AT_WINTER_HEAVY_DIAGONAL` | 2 | 6 | 7 |
| `DE_SUMMER` | 1.6 | 1.6 | 3 |
| `DE_WINTER` | 1.6 | 1.6 | 4 |

Tread comparisons are strictly **below**, not below-or-equal. `URGENT` takes precedence over `RECOMMENDED`, otherwise status is `GOOD`. Age recommendations never make a tyre `URGENT`.

| Reason code | Exact trigger / effect |
|---|---|
| `TREAD_BELOW_LEGAL_MINIMUM` | Minimum tread below ordinary minimum → `URGENT` |
| `AT_WINTER_TREAD_INSUFFICIENT` | Not below ordinary minimum, but below Austrian winter profile minimum → `URGENT`; insufficient winter tread is distinct from the ordinary floor |
| `TREAD_REPLACEMENT_RECOMMENDED` | Meets legal/profile minimum but is below the resolved recommendation → `RECOMMENDED` |
| `DE_ALPINE_MISSING` | German winter/all-season tyre explicitly marked `M_S` → `URGENT`; `NONE` or an omitted marking does not trigger this reason in T1 |
| `AT_WINTER_RULE_NOTICE` | German winter/all-season tyre with minimum tread ≥1.6 and <4 → informational Austrian winter-rule notice; not an Austrian fallback evaluation |
| `DOT_CONDITION_CHECK_RECOMMENDED` | DOT age/lower bound ≥72 months → information only |
| `DOT_REPLACEMENT_RECOMMENDED` | DOT age/lower bound ≥96 months for winter/all-season, ≥120 for summer → `RECOMMENDED` |
| `DOT_LEGACY_OVER_20_YEARS` | Legacy DOT with conservative age lower bound ≥240 months → additional age reason, not a legal ban |
| `UNSUPPORTED_COUNTRY` | Country other than AT/DE → only this reason, null status/thresholds; retain valid tread/DOT facts |

### DOT semantics

Accept a standalone three- or four-digit date code, or a full identifier with whitespace separating the final date token. For example, `DOT ABC4 120` is legacy; `DOT ABC4120` and `14320` are rejected rather than guessed to be modern. Extra digits and unseparated identifier/date boundaries are invalid.

A modern trailing `WWYY` denotes year `2000 + YY`. Use the **UTC ISO-week Monday as a representative**, not a precise manufacturing date; `ageMonths` is completed UTC calendar months from that representative at capture. Reject invalid format, invalid week (including a nonexistent week 53), future representative dates and invalid evaluation dates.

Legacy three-digit `WWY` accepts weeks 1–53 but cannot resolve the decade: `productionYear`, `productionDate` and `ageMonths` stay null. `minimumAgeMonths` is the conservative pre-2000 lower bound, calculated as completed months since `2000-01-01T00:00:00Z`, clamped to zero. No exact year or date is invented. Missing DOT produces no age reasons.

### Recommendation overrides

Persist overrides by profile in `TyreStorageSettings.recommendationOverrides`, each containing `recommendedBelowMm`. Omission in a settings update preserves the stored overrides; `{}` resets to defaults. Values must be finite, at least the profile's default and at most 20 mm: overrides can only raise the amber recommendation. Ordinary/legal floors are immutable. A supplied `legalMinimumMm` must equal the fixed value and is not retained as an override; unknown profiles or fields are rejected. Only future captures use changed settings.

## UX Compliance / Component Design

No components, page actions, forms, uploads or new realtime dashboard wiring in T1. T2/T3 cover UI and hotel capture separately. Documentation and future copy are DE/EN only. Existing tyre-storage event behavior and retarget helpers are unchanged.

## Verification

- Pure tests cover eight profiles, exact boundaries/reasons, mixed tyres, DOT week/year/age cases, unsupported countries and override validation. DTO tests reject excess precision, including exponent-form numbers, without throwing.
- Backend E2E covers order/check-in creation, detail and parent reads, ADMIN/TECH access, tenant/site isolation, inactive memberships, duplicates, invalid facts and mismatched media. OWNER/SALES share the existing role guard but are not separate HTTP fixtures.
- E2E also verifies frozen reads after settings changes, default/captured weight provenance, author snapshot survival, referenced-media deletion restrictions, order/site and tyre-set/vehicle FK protection, settings omission/reset and unchanged legacy JSON.
- Existing check-in uploads use a unique object key per attempt while preserving the client upload ID for database idempotency. A regression test proves failed-attempt cleanup cannot target the successful retry's object. Storage is mocked in these tests; live object storage was not exercised.

## Open Questions / Tracking

No open T1 scope questions. Tracking: AUT-802. Hotel writes/backfill, UI and uploads are excluded; this specification does not authorize T2/T3 implementation.

## References

- [Tyre storage](tyre-storage.md); [ADR-0022: site operational scope](../../01-ADR/2026-08-31-site-operational-scope.md).
- Exact pure rules: `apps/core-api/src/tyre-measurement/tyre-dot.ts`, `tyre-evaluation.ts`, `tyre-thresholds.ts`.
