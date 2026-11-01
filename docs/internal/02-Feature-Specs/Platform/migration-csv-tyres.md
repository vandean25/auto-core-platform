---
title: "Migration CSV v1.1: tyre sets"
date: "2026-10-19"
module: Platform
status: accepted
linear-project: "incadea Migration"
tags: [feature-spec, platform, migration, tyre-storage]
---

# Migration CSV v1.1: tyre sets

## Status

**Accepted contract baseline — 2026-10-19, Product Owner request in AUT-648.** Acceptance defines the dictionary; it does not certify importer support or authorize production cutover. AUT-636 must satisfy the implementation prerequisites and evidence gates below.

## Summary

Complete `tyre_sets.csv` for customer-owned sets at the cutover snapshot. This is the normative tyre dictionary for **format_version `1.1`**, linked by the file registry and manifest schema in [Canonical Migration CSV](migration-csv-format.md). The central specification owns version dispatch, CSV/scalar rules, namespaces, manifest validation and shared apply policy. Its `1.0` contract remains unchanged: that version reserves this filename but has no executable tyre dictionary. Do not accept these rows as `1.0` or silently reinterpret an unsupported version.

The private extractor aggregates source wheels into one stable set row. Only canonical dealer-domain data and synthetic examples belong in ACP. [ADR-0031](../../01-ADR/2026-10-19-incadea-migration-hard-cutover.md) governs cutover, company/legal-entity ownership, privacy and stage order. This specification adds no extractor, importer or runtime behavior.

## User Stories

- As a service adviser, I want stored customer tyres, their location and known condition available on day one.
- As migration operations, I want unresolved ownership and missing measurements reported without fabricated tyre details.
- As an operator, I want retrying a bundle to preserve one set and one honest import baseline without duplicate storage events.

## Exact `tyre_sets.csv` dictionary

All headers are mandatory, in the following order. R/O describes cell values, not header presence. `id`, `code`, `text`, `multiline`, `date` and blank/update semantics inherit the central scalar rules. Optional values create null unless stated otherwise. No source enum aliases or guessed defaults.

| Column | Value | Meaning / validation |
|---|---|---|
| external_id | R id | Stable set identity; maps as TYRE_SET, never a wheel identity. |
| customer_external_id | R id | CUSTOMER reference in the same tenant/company namespace; skipped/anonymized/unresolved customer blocks. |
| vehicle_external_id | O id | VEHICLE reference; blank genuinely means unknown/unassigned. Supplied unresolved reference blocks. |
| site_code | R code | Explicit approved active site in the bundle's legal entity; never infer from current switcher. |
| bin_code | O code | Configured StorageLocation reference within site_code. Unknown, ambiguous, deleted or other-site location blocks. |
| bin_label | O text | Human-readable bin description. Label-only storage requires the approved policy below. |
| label | R text | Human-readable set label; not a unique key. |
| season | R enum | SUMMER, WINTER, ALL_SEASON (TyreSeason). |
| tyre_count | R integer | 1–6; no default from omitted source count. |
| rim_type | R enum | NONE, STEEL, ALLOY (TyreRimType); NONE means known absence of rims, not unknown. |
| brand | O text | Known common set brand; blank for unknown or differing per-position brands. |
| model | O text | Known common model; blank for unknown or differing per-position models. |
| dimension | O text | Known common size, e.g. 205/55 R16; preserve load/speed suffix when supplied. Never infer from vehicle. |
| positions_json | O JSON object | Exact positional dictionary below; structured facts must not be flattened into condition_notes. |
| condition_notes | O multiline | Supplied damage, mixed-season, TPMS or condition observations; no invented inspection result. |
| status | R enum | IN_STORAGE, ON_VEHICLE, RETURNED, DISPOSED (TyreSetStatus). |
| stored_since | O date | Known beginning of current storage spell for IN_STORAGE, or most recent known spell for other statuses. Unknown never becomes cutover/apply date. |
| last_change_on | O date | Last actual source storage/status change, not extraction, edit or future swap date. |
| planned_swap_on | O date | Explicit known planned swap date; blank unknown, no settings-derived migration default. |

### Positional detail cell

`positions_json` is strict JSON: no duplicate keys, comments or additional properties. It is a nonempty object whose only allowed position keys are **FL, FR, RL, RR, SPARE_1, SPARE_2** (front left/right, rear left/right, first/second spare). FL/FR/RL/RR match today's tread-depth DTO. SPARE_1/SPARE_2 are explicit canonical additions requiring storage/DTO support, never discarded. Do not guess position from source row order. If positional information is unavailable, leave the cell blank and report incomplete data.

Each present position is an object with exactly these five required property names; JSON null means unknown inside this cell. Empty strings, synthetic DOT values and zero measurements must not substitute for unknowns.

| Property | Type | Rule |
|---|---|---|
| brand | text or null | Known individual brand; no fuzzy Brand/catalog creation. |
| model | text or null | Known individual model. |
| dimension | text or null | Known individual technical size. |
| dot_code | string or null | Four digits WWYY; week 01–53. Canonical production years 2000–2099; older/ambiguous codes require upstream clarification, never guessed century. Reject a production year later than cutover year; a week code is not an exact manufacturing date and must not become one. |
| tread_depth_mm | decimal string or null | Exactly two fraction digits, 0.00–20.00 mm inclusive; no exponent/sign/grouping. Verified source unit conversion upstream; no cm/inch guessing. 0.00 is a supplied measurement, distinct from null. |

Present position count must not exceed tyre_count. Five/six tyres require five/six distinguishable position keys when full positional detail is available. Partial detail is allowed with a completeness warning; no wheel is silently assigned to a missing position. All-null observations warn. Differing individual dimensions/brands/models require the corresponding common set column blank; a nonblank common value must equal every nonnull individual value. A common value does not assert an unobserved position/measurement. Mixed seasons are not a fourth enum: an upstream approved mapping supplies one operational TyreSeason and preserves the observation in condition_notes with a warning; otherwise block ambiguous season. No roadworthiness inference from tread/DOT.

## Ownership, incomplete data and snapshot status

Resolve customers and vehicles before tyres using the central namespace and typed mappings only. Vehicle/customer ownership must satisfy target tyre-service validation: a vehicle assigned to another customer blocks; an unassigned vehicle does not silently gain an owner. Labels, customer+season, dimensions and plates are never matching keys. Duplicate external_id blocks, even identical rows. Conflicting mappings or two distinct external IDs accidentally resolving to one target set block instead of merge.

Resolve site_code/bin_code through OWNER/ADMIN-approved configuration; CSV data grants no authorization. Recheck active site under the operational site lock at apply. Reject foreign-tenant/company sites and locations. bin_label grants no location access. IN_STORAGE without a structured bin is allowed only with an explicit dry-run-approved **allow_bin_label_only** policy and nonempty bin_label, producing a warning. Otherwise IN_STORAGE requires bin_code. An invalid supplied bin_code never falls back to its label.

| Status | Snapshot constraint |
|---|---|
| IN_STORAGE | Currently in site custody. Requires resolved bin or approved label-only rule; unknown stored_since warns. |
| ON_VEHICLE | Not stored; bin_code/bin_label blank. Vehicle reference required to substantiate status. |
| RETURNED | Returned to customer, not stored; bin_code/bin_label blank. |
| DISPOSED | Disposed and terminal; bin_code/bin_label blank. Never recreate custody. |

AUT-636 defaults to IN_STORAGE extraction. RETURNED sets changed within the last 12 calendar months require explicit historical-scope approval; inclusive lower bound is cutover_date minus 12 calendar months, clamped at month-end, with last_change_on required to prove eligibility. ON_VEHICLE/DISPOSED are valid contract states requiring explicit approved scope/capability. Unsupported scopes block, never drop rows. Counts cover every supplied row before policy/apply decisions.

Unknown brand/model/dimension/DOT/tread, stored_since and last_change_on for default IN_STORAGE rows cause field-specific incomplete-data warnings. They do not license invented values, dates or an automatic inspection. Missing customer/site/season/count/rim/status blocks. Unknown required enum must be clarified upstream or quarantined outside the accepted bundle; never map unknown rims to NONE or season to ALL_SEASON. Operators reconcile all incomplete-data warnings before cutover acceptance.

Dates must be real Gregorian YYYY-MM-DD. stored_since/last_change_on must be on/before cutover_date and the approved extraction business date under the central 1.1 rule (AT Europe/Vienna, DE Europe/Berlin; never the host/UTC date by accident); stored_since must be on/before last_change_on when both exist. planned_swap_on may be overdue or future; no automatic rescheduling. A planned date never proves a historical change. Do not infer dates from DOT.

## Identity, replay and event history

Use `(tenant_id, TYRE_SET, source_system, external_id)` in ExternalIdMapping. Create set, mapping and durable import baseline atomically; concurrent identical submissions produce one set/baseline. Store accepted canonical row/hash and bundle/run provenance. Exact replay is a no-op, including events, dates and due-list state. After an operational tyre event, changed migration snapshots block for explicit reconciliation, never overwrite live state. Before operations, changed input may use the central dry-run/update policy with optimistic guards and an appended import correction audit; never rewrite an append-only baseline.

The row is a **snapshot**, not historical check-in/out actions. Initial history records one explicitly identified **IMPORT_BASELINE** at actual apply time, with source status/location, source stored_since/last_change_on (including nulls), namespace, set external ID and run/hash provenance. IMPORT_BASELINE names required migration semantics, not a currently available TyreSetEventType: implement a dedicated event type or a separate immutable migration receipt plus imported-state projection. Do not write CHECK_IN, CHECK_OUT, INSPECTED or DISPOSED merely to force today's projector into imported status. Source dates stay labelled source dates; occurred_at must not masquerade as a source action time.

Importer and projector must support this baseline before apply. Native events start from imported state under existing guards: CHECK_IN from non-stored/non-disposed state; CHECK_OUT/MOVED only while stored; checkout produces ON_VEHICLE and clears location; disposal clears location and makes the set terminal. Native events must not predate the baseline. RETURNED may be imported; no new native return workflow here. Existing mapped sets with native history cannot receive another initial baseline. A crash rolls back the entire set/mapping/baseline transaction or safely retries it.

Customer-owned sets create **no InventoryStock, InventoryTransaction, vehicle-stock ledger, valuation, invoice, number sequence or financial posting**. stored_since is descriptive custody evidence, not a financial posting date.

## Manifest and reconciliation

The central **v1.1** manifest schema is authoritative. `control_totals.counts_by_type.tyre_sets` equals logical data-row count and files[].row_count. `control_totals.domain_counts.tyre_sets` is **null iff tyre_sets.csv is absent**. When present it is an exact object containing every TyreSetStatus key, including zeros and for a header-only file:

```json
{"IN_STORAGE":0,"ON_VEHICLE":0,"RETURNED":0,"DISPOSED":0}
```

Values are integers 0–2147483647; no additional/missing/aliased status keys. Recompute buckets from supplied row status before skips, creates, updates or no-ops; sum equals both row counts. For the synthetic row below use `{"IN_STORAGE":1,"ON_VEHICLE":0,"RETURNED":0,"DISPOSED":0}`. Wrong buckets block even when grand total matches. Tyres contribute nothing to opening-stock value. Hash exact received bytes under the central rule.

## Synthetic valid CSV example

Assume same-namespace CUSTOMER CUST-001 and VEHICLE VEH-001 mappings with compatible ownership, and approved SITE-A/TYRES-A1 active same-company site/bin. cutover_date is 2026-11-01; extracted_at is 2026-11-01T06:00:00Z; required target capability is installed. Identifiers are synthetic. Emit CRLF after header/row and compute SHA-256 rather than inventing a checksum. This two-tyre set intentionally demonstrates that count is not defaulted to four.

```csv
external_id,customer_external_id,vehicle_external_id,site_code,bin_code,bin_label,label,season,tyre_count,rim_type,brand,model,dimension,positions_json,condition_notes,status,stored_since,last_change_on,planned_swap_on
TYRE-001,CUST-001,VEH-001,SITE-A,TYRES-A1,A1,Synthetic winter pair,WINTER,2,ALLOY,Synthetic Tyres,Snow Example,205/55 R16,"{""FL"":{""brand"":""Synthetic Tyres"",""model"":""Snow Example"",""dimension"":""205/55 R16"",""dot_code"":""1024"",""tread_depth_mm"":""6.50""},""FR"":{""brand"":""Synthetic Tyres"",""model"":""Snow Example"",""dimension"":""205/55 R16"",""dot_code"":""1024"",""tread_depth_mm"":""6.40""}}",Source reports no damage,IN_STORAGE,2026-04-10,2026-04-10,2026-11-15
```

## Database Impact

### New Tables / Columns and Modified Tables

Documents only in this PR. Current TyreSet supports common brand/model/dimension, unpositioned dot_codes, JSON tread measurements, site/location/status, stored_since and planned_swap_on. It has **no last_change_on or positional brand/model/dimension/DOT storage**. TyreSetEventType has no import baseline. Native creation defaults IN_STORAGE and creates CHECK_IN at current time; it is not the migration path.

| Required target change | Implementation prerequisite |
|---|---|
| Preserve positions_json and last_change_on losslessly | Add durable structured target storage and additive migration; round-trip differing individual facts. Disposable staging rows or prose notes are insufficient. |
| Honest baseline and correction provenance | Dedicated TyreSetEvent type or immutable migration receipt with projector support and unique initial identity; approve schema design/migration before apply. |
| TYRE_SET mapping and replay guards | Implement missing mapping capability and atomic identity/run uniqueness; filename recognition is insufficient. |
| SPARE_1/SPARE_2 and blank planning dates | Extend target validation/read paths and bypass native create's inferred dates/action side effects. |

AUT-636's earlier “no Prisma migration” and synthetic “migrated” event assumptions require reconciliation with these prerequisites. Schema/API work belongs to its approved implementation plan; do not weaken this contract to fit current storage. Unsupported nonempty semantics fail explicitly.

### Deletion Policy Impact

Existing TyreSet deletion is allowed only without TyreSetEvent; events are append-only. Import baselines must also prevent set hard deletion and remain immutable, including separate receipts. AUT-636 must update [deletion policy](../../../deletion-policy.md) for any new baseline entity/relationship. Missing rows never delete sets; corrections never rewrite native history.

## API Contract Changes

No new/modified endpoint or generated artifact here. AUT-645 validates this dictionary; AUT-636 adds capability. Native endpoints do not imply migration support. If positional/baseline/date data changes DTOs/Swagger, implementation must regenerate and commit both:

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

## UX Compliance

No new page/action/form/component. Existing screens must display imported state and known measurements accurately, distinguishing source dates from native events. Import feedback must expose incomplete details, unresolved references and unsupported capability. Standard DataTable, StatusBadge, top-right actions and auto-save rules apply to any future UI changes. No messaging or consent change.

### Real-Time Sync

No entity-map change here. AUT-636 verifies existing tyre invalidation after committed apply; exact replay emits no duplicate event. No stock/financial dashboard effects.

## Component Design

No React changes. The canonical validator/preset and tyre handler own future validation/apply; baseline projection must be designed with tyre readers. This dictionary creates no wheel-stock module.

## Testing Plan

Documentation: parse synthetic CSV/positions_json; check exact header/order/count, dates, enum map, measurements, links and whitespace. Runtime tests are future implementation gates, not evidence claimed here.

- [ ] Valid four-position set imports exact details/dates/bin; due list uses supplied planned_swap_on. Include the two-position example and five/six-wheel cases.
- [ ] Unknown optional facts remain null with warnings; missing required values, nonexistent dates, invalid DOT weeks/future actual dates, depth outside 0–20 and contradictory common/position facts block.
- [ ] Missing/duplicate/reordered headers, duplicate IDs/JSON position keys, excessive position count, unknown JSON properties/enums, wrong status totals and missing zero buckets block.
- [ ] Missing/skipped customer, unresolved supplied vehicle, incompatible ownership, foreign tenant/company/site or deleted/inactive site/bin blocks. Label-only requires approved policy; invalid supplied bin never falls back.
- [ ] Each status obeys location/history/scope rules; unsupported spare/date/baseline capability blocks without partial apply or lost data.
- [ ] Replay, concurrency and failure retry create one set/mapping/baseline and zero synthetic CHECK_IN/CHECK_OUT events; native history blocks snapshot overwrite.
- [ ] Genuine checkout after baseline adds one event, clears location and agrees with projector. Terminal disposal and baseline deletion guards hold.
- [ ] Present/header-only/absent file yields full status map/zero map/null. Hash/count/status mismatch blocks; stock/financial ledgers/sequences stay unchanged.
- [ ] Positional facts/source dates survive staging retention expiry; verify UI date distinction and due-list behavior after implementation.

## Open Questions and Delivery Gates

No wire-format decision is delegated to the extractor. Production completeness, historical scope, label-only bins and source-unit evidence require rehearsal decisions under AUT-634. Target persistence, baseline projection and schema/API scripts require approved AUT-636 design before apply. Dictionary acceptance is not evidence of implementation.

## References

- [Canonical registry, shared scalar rules and v1.1 manifest schema](migration-csv-format.md)
- [ADR-0031](../../01-ADR/2026-10-19-incadea-migration-hard-cutover.md)
- [Tyre storage](../Workshop/tyre-storage.md)
- Target evidence: repository paths `apps/core-api/prisma/schema.prisma`, `apps/core-api/src/tyre-storage/dto/tyre-set.dto.ts`, `tyre-storage.service.ts`, `tyre-set-event.helpers.ts`.

## Linear Tracking

| Field | Value |
|---|---|
| Project | incadea Migration |
| Milestone | Canonical dictionaries before handler implementation |
| Issues | [AUT-648](https://linear.app/auto-core-platform/issue/AUT-648) specification; [AUT-636](https://linear.app/auto-core-platform/issue/AUT-636) implementation; AUT-645 validator; AUT-634 rehearsal/cutover |

Boundary fixture: extracted_at 2026-10-31T23:30:00Z has business date 2026-11-01 in Europe/Vienna; stored_since/last_change_on 2026-11-01 with cutover 2026-11-01 is valid. A later actual date remains invalid.
