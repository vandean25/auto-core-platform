# Tyre measurement (Reifenmessung)

## Summary

AUT-802 T1 defined append-only tyre evidence on workshop orders and reception check-ins. AUT-803 T2 connects the tyre hotel: check-in, check-out and inspection events can record wheel readings into the same evidence model, tyre sets expose their latest measurement, and legacy tread JSON is backfilled. AUT-804 T3 adds the shared report and capture UI to orders, reception and the tyre hotel, reusing the existing check-in photo queue. Title, tread JSON and backend evidence policies stay in place.

## User Stories

- Workshop desk staff and technicians record tyre condition, then read the same evidence even after settings, vehicle data or author membership changes.

## Database Impact

- Add `TyreMeasurement` and child `TyreWheelReading` tables through an additive migration. Persist tenant/site scope, parent and vehicle bindings, capture time, country, weight class and its provenance. Enforce distinct positions per measurement and index scoped parent-history reads.
- Store raw per-wheel tread inner/middle/outer values, season, construction, winter marking and DOT relationally, not only in a JSON payload. At most five distinct positions: `FL`, `FR`, `RL`, `RR`, `SPARE`. Each tread value is finite and within **0–20 mm**, inclusive; the lowest of the three decides. Mixed tyres are evaluated independently.
- Freeze each wheel's evaluation snapshot at capture: `version: 1`, `rulesVersion: AT_DE_2026_10`, country, evaluation time, weight class, minimum tread, resolved thresholds, parsed DOT, state, status and reason codes. Persist readings and snapshots atomically. Later settings changes do not alter them.
- `measured_by` is a nullable FK to `User` with `ON DELETE SET NULL`, alongside an immutable author display snapshot. There is **no `TenantMember` FK**; membership removal must not destroy attribution.
- Evidence parents and referenced media use restrictive FKs, not cascading deletion. Existing retarget helpers remain unchanged: composite FK restrictions alone prevent changes that would invalidate evidence bindings; no automatic retargeting of measurements.
- No new workflow state machine, stock movements, fiscal records or sequential numbering. Deletion rules are in [Entity Deletion Policy](../../../deletion-policy.md#aut-802--tyre-measurement-evidence).
- Hotel event measurements link `tyre_set_id` and `tyre_set_event_id`; an event measurement also carries its set because the T1 constraint requires it. The event and its measurement are written in one transaction.
- Backfilled evidence uses `source = LEGACY_TREAD_JSON` with `source_ref = "set:<id>"` or `"event:<id>"`, unique per tenant. Live captures keep `source = CAPTURE` and a null `source_ref`.

### Capture context and photos

- Resolve tenant/site through authenticated context and validate every parent/media reference within that scope. Derive the document's site from its parent and require it to match the active site; recheck site activity when creating.
- Capture `country` from the site's `LegalEntity`, never from a request default. The current shared fiscal schema permits only `AT`/`DE`; this feature does not expand it. The capture payload supports other countries (tested with `ES`): valid facts retain state/reason `UNSUPPORTED_COUNTRY` and **null status and thresholds**, without an Austrian fallback. This path becomes reachable through the API when legal entities support those countries.
- `Vehicle` has no authoritative permissible gross-weight field. Never infer this class from kerb mass or a vehicle name. Explicit `weightClass` is `UP_TO_3500_KG` or `OVER_3500_KG`, with provenance `CAPTURE`; omission uses `UP_TO_3500_KG` with provenance `DEFAULT`.
- Optional wheel photos reference only existing **image** `WorkshopMedia` with purpose `CHECK_IN`, attached to the matching check-in and workshop order in the same tenant/site. Reject signatures, videos, unattached media and mismatched parents. An order without a check-in has no photo support. Hotel photo support remains later work; this phase adds no upload route.

## API Contract Changes

| Method | Route | Purpose |
|---|---|---|
| POST / GET | `/api/workshop-orders/:id/tyre-measurements` | Append evidence / list order history |
| POST / GET | `/api/workshop-check-ins/:id/tyre-measurements` | Append evidence / list check-in history |
| GET only | `/api/tyre-set-events/:id/tyre-measurements` | Read event-linked evidence |
| GET only | `/api/tyre-measurements/:id` | Read one stored measurement with readings and snapshots |
| POST | `/api/tyre-sets/:id/check-in` | Move into storage; optional `wheels` writes event evidence |
| POST | `/api/tyre-sets/:id/check-out` | Move out of storage; optional `wheels` writes event evidence |
| POST | `/api/tyre-sets/:id/inspect` | Record an inspection; optional `wheels` writes event evidence |

All measurement reads and creates allow `OWNER`, `ADMIN`, `SALES`, `TECH`, with active tenant/site authorization, including nested reads. Creates accept wheel facts, optional weight class and eligible existing media references; parent bindings, actor, country and evaluation come from the server. Lists use `{ data, meta }`. No PATCH, PUT or DELETE measurement API; corrections are new measurements, not edits.

Hotel event routes reuse `TyreSetLocationActionDto`. `wheels` is accepted only on `CHECK_IN`, `CHECK_OUT` and `INSPECTED`; `MOVED` and `DISPOSED` reject readings with `TYRE_MEASUREMENT_EVENT_INVALID`. Readings require a set linked to a vehicle (`TYRE_MEASUREMENT_VEHICLE_REQUIRED`) and reject media ids (`TYRE_MEASUREMENT_MEDIA_INVALID`); an optional `workshopOrderId` must belong to the set's vehicle (`TYRE_MEASUREMENT_ORDER_MISMATCH`). An optional `weightClass` is forwarded to the measurement and recorded with `CAPTURE` provenance; omission keeps the `UP_TO_3500_KG` default. Events without readings behave exactly as before. Wheel validation, DOT parsing and evaluation are the T1 capture code; this route adds no duplicate rules.

`INSPECTED` keeps the current location and status and is the only hotel event available to `TECH` (marked `@MechanicAccessible`); `CHECK_IN`/`CHECK_OUT` remain `OWNER`/`ADMIN`/`SALES`. Set detail and list rows expose `latestMeasurement` with the newest measurement's frozen wheel snapshots (evaluation status, reason codes, DOT age data) plus `worstStatus`; pages load it with one batched query instead of per-row queries. Captures that share a measurement time resolve to the newest stored row, so a later correction is not hidden by an older snapshot.

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

## Legacy tread backfill

Existing `TyreSet.tread_depth_mm_json` and `TyreSetEvent.tread_depth_mm_json` stay untouched and remain the fallback for old records. The backfill converts each non-empty legacy JSON object into one `TyreMeasurement` with one `TyreWheelReading` per recognised position (`FL`, `FR`, `RL`, `RR`, `SPARE`, case-insensitive). Legacy data has only one value per position, so it is stored as `tread_middle_mm`; `tread_inner_mm` and `tread_outer_mm` stay null. Evaluation uses the middle value for all three points at the measurement timestamp.

A set snapshot is dated by the set's `updatedAt`, the last time its legacy JSON could have changed, so a later tread correction outranks an older event reading. This is an explicit approximation, not the original capture time. Event snapshots keep their `occurred_at`. Because an event can update the set without touching its tread JSON, a set that already has live `CAPTURE` measurements keeps its legacy JSON unlinked: promoting the approximate snapshot could otherwise replace worn live evidence with stale healthy JSON. The same applies to an event that already has a live measurement linked by `tyre_set_event_id`; an event can carry both `treadDepthMm` and `wheels`, and the legacy value only covers the middle point. The run counts these sets and events as skipped and warns, leaving the JSON in place for a later live capture.

- Position keys are normalised; unknown keys, duplicate spellings, non-numeric values, values outside 0–20 mm and values with more than hundredth precision are skipped and counted in the run summary with a capped sample. Skipped values stay in the untouched legacy JSON rather than being rounded into a different number.
- Sets without a vehicle, with no usable reading, or with existing live measurements produce no set measurement and are counted separately; events with existing live measurements produce no event measurement. The run reports each case visibly rather than silently guessing.
- `source_ref` (`set:<id>` / `event:<id>`) makes the run idempotent: a second run reports conversions as already done and writes nothing. One measurement per parent, no updates, no deletes.
- Runs are tenant-scoped (all tenants, or `--tenant=<id>`), cursor-batched and write-limited. Event measurements link their set and, when the referenced workshop order matches the set's site and vehicle, that order.

Run from the repository root, dry-run first, then execute:

```bash
npm run db:backfill:tyre-measurements --workspace=core-api
npm run db:backfill:tyre-measurements --workspace=core-api -- --execute
npm run db:backfill:tyre-measurements --workspace=core-api -- --execute --tenant=<tenant-id>
```

`AUT-636` (tyre hotel import) must write `TyreMeasurement` / `TyreWheelReading` directly; the JSON backfill is not a long-term write path.

## UX Compliance / Component Design

### T3 shared report and capture (AUT-804)

- `TyreReport` is shared by workshop orders, reception check-ins and tyre hotel detail/latest-measurement views. Render the stored server evaluation snapshot: status, localized reasons, DOT age or conservative minimum age, worst tread highlight and threshold legend. Do not recalculate from current settings or hardcode client thresholds. Amber always means a recommendation, never a legal limit; legal/profile minima remain distinct. Unsupported evaluation and absent DOT/tread facts stay blank rather than becoming zero or an invented age/status.
- Wheel layout uses `FL`, `FR`, `RL`, `RR` and optional `SPARE`, with localized position labels. Capture uses three numeric tread points per recorded wheel (inner/middle/outer), each 0–20 mm inclusive, plus brand, model, size, season, DOT, construction and winter marking. Weight class belongs to the measurement. The copy action copies only brand/model/size to all wheels; it does not copy tread or legal context. The lowest point per wheel drives the stored evaluation.
- Workshop order detail has a report section and the registry action **Reifenmessung erfassen** / **Record tyre measurement**, also reachable via Cmd+K with identical role gating. Reception embeds capture/report in the condition step; keep the existing three-step flow and check-in offline queue, not a fourth step.
- Tyre hotel exposes `latestMeasurement` and opt-in wheel capture on `CHECK_IN`, `CHECK_OUT` and `INSPECTED`; no readings on move/dispose. A vehicle link is required. Leaving capture off preserves existing event behaviour. Inspection changes neither status nor location.
- `OWNER`/`ADMIN`/`SALES`/`TECH` may read reports and record order/check-in evidence within authorized tenant/site scope. Hotel `TECH` may inspect and record readings but cannot check in/out; those actions remain `OWNER`/`ADMIN`/`SALES`. UI gating mirrors the backend, not a new permission policy.
- Measurement capture currently requires a connection. There are no persisted or queued offline measurement drafts. Only existing check-in photos use the offline photo queue; wait for successful upload before saving a measurement that references them. Photos must be attached to the order's matching check-in. An order without a check-in has no photo support. Hotel event photos remain unavailable and rejected by the backend, even when an event links an order.
- Corrections append a new measurement; no edit/delete of stored evidence. T3 does not change backend evaluation, upload/media eligibility, retarget helpers, deletion rules, state transitions, stock or fiscal policies, and adds no new realtime dashboard wiring. Copy and documentation are matching DE/EN, with German authoritative.

### T3 verification scope

These are UI acceptance checks, not a claim that the backend fixtures below exercise the UI:

- Shared report tests cover server snapshot status/reasons/thresholds, amber recommendation wording, lowest/worst tread highlighting, DOT age versus legacy minimum age, unsupported evaluation and blank missing fields.
- Form tests cover all wheel positions and optional spare, numeric range/invalid values, three tread points, metadata and weight class, copy-only brand/model/size, pending/error save handling and no offline measurement persistence.
- Order/check-in integration checks cover the registry action and Cmd+K role parity, condition-step placement with three steps unchanged, existing offline photo queuing, and blocking measurement save until referenced photos upload.
- Hotel integration checks cover latest report rendering, opt-in capture on all three supported events, unchanged actions without readings, required vehicle, TECH inspect-only gating, and no photo controls/media payload for hotel events.

## Verification

- Pure tests cover eight profiles, exact boundaries/reasons, mixed tyres, DOT week/year/age cases, unsupported countries and override validation. DTO tests reject excess precision, including exponent-form numbers, without throwing.
- Backend E2E covers order/check-in creation, detail and parent reads, ADMIN/TECH access, tenant/site isolation, inactive memberships, duplicates, invalid facts and mismatched media. OWNER/SALES share the existing role guard but are not separate HTTP fixtures.
- Hotel E2E covers readings on check-in, check-out and inspection, unchanged behaviour without readings, latest/worst exposure, order linkage, unsupported events, missing vehicle, media rejection, TECH inspect-only and tenant/site isolation.
- Backfill E2E covers dry-run, middle-only conversion, warnings for unusable and over-precise values, idempotent second run, untouched legacy JSON, tenant isolation, set-snapshot recency after a later tread correction (with the fixture's creation time before the event), a wheels-only inspection followed by backfill keeping the live capture newest, an event carrying both tread JSON and wheels keeping its full live reading, and the latest-measurement read after conversion.
- Hotel E2E also covers equal capture times resolving to the newest row and an explicit heavy-vehicle weight class with `CAPTURE` provenance.
- E2E also verifies frozen reads after settings changes, default/captured weight provenance, author snapshot survival, referenced-media deletion restrictions, order/site and tyre-set/vehicle FK protection, settings omission/reset and unchanged legacy JSON.
- Existing check-in uploads use a unique object key per attempt while preserving the client upload ID for database idempotency. A regression test proves failed-attempt cleanup cannot target the successful retry's object. Storage is mocked in these tests; live object storage was not exercised.

## Open Questions / Tracking

Tracking: AUT-802 (T1), AUT-803 (T2), AUT-804 (T3 shared report and capture UI). T3 reuses check-in photo uploads; hotel event photos and offline measurement drafts remain excluded. The optional MCP `get_tyre_report` tool was not added in T2 and is not part of T3; MCP `list_tyre_sets` is unchanged.

## References

- [Tyre storage](tyre-storage.md); [ADR-0022: site operational scope](../../01-ADR/2026-08-31-site-operational-scope.md).
- Exact pure rules: `apps/core-api/src/tyre-measurement/tyre-dot.ts`, `tyre-evaluation.ts`, `tyre-thresholds.ts`.
