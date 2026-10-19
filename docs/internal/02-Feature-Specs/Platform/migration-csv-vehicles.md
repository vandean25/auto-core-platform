---
title: "Canonical Migration CSV 1.1 — Vehicle Parties, Due Dates and Notices"
date: "2026-10-19"
module: Platform
status: accepted
linear-project: "incadea Migration"
linear-milestone: ""
tags: [feature-spec, platform, migration, vehicle]
---

# Canonical Migration CSV 1.1 — Vehicle Parties, Due Dates and Notices

## Status

**Accepted — 2026-10-19, Dejan Dosenovic (Product Owner).** AUT-647 specification baseline for canonical revision `1.1`. Acceptance authorizes the dictionary, not production imports. AUT-641/AUT-642 models, services, importer and evidence gates remain prerequisites.

## Summary

Complete `vehicle_parties.csv`, `vehicle_due_dates.csv` and `vehicle_notices.csv` with source-agnostic dictionaries. The [canonical contract](migration-csv-format.md) supplies the revision registry, CSV/scalar rules, namespace, manifest schema, privacy gates and dependency order. [ADR-0031](../../01-ADR/2026-10-19-incadea-migration-hard-cutover.md) governs cutover. These dictionaries are normative for `format_version = "1.1"` only; `1.0` remains immutable and its vehicle outline files remain unsupported. No runtime importer, extractor or production migration is delivered here.

R/O means required/optional **value**; every header is mandatory in the exact order shown. Blanks inherit central create-null/update-leave-unchanged semantics. Validate the resulting effective row and graph after that rule. Scalar bounds/lexical rules are inherited except the explicit integer-kilometer rule below.

## User Stories

- As service intake, I can identify the active owner and payer without losing relationship history.
- As migration operations, I can preserve evidenced inspections, service due information and recalls with repeatable identities and reconciled counts.
- As a workshop user, I can see due dates and warnings without sending reminders or inventing performed inspections.

## File dictionaries

### `vehicle_parties.csv`

```csv
external_id,vehicle_external_id,customer_external_id,role,valid_from,valid_to,notes
```

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | `VEHICLE_PARTY` external identity. |
| vehicle_external_id | R id | `VEHICLE` in this tenant/company namespace. |
| customer_external_id | R id | `CUSTOMER` reference, including organizations. |
| role | R enum | `OWNER`, `DRIVER`, `USER`, `BILL_TO`, `LEASING`, `INSURANCE`, `WARRANTY_PROVIDER`, `SERVICE_CONTRACT`, `PREVIOUS_OWNER`. |
| valid_from | O date | Inclusive relationship start; blank on creation means unknown/unbounded lower bound. |
| valid_to | O date | Exclusive end; blank on creation means open-ended. If both dates exist, `valid_from < valid_to`. |
| notes | O multiline | Plain relationship context. |

AUT-641 introduces `VehicleParty` and `VehiclePartyRole` with these exact tokens; they are not present in today's Prisma schema. The handler assigns `LEGACY_IMPORT` provenance. CSV does not supply trusted actors or authorization.

### Validity, main contact and payer precedence

Use `manifest.cutover_date` as a calendar date. A party is active on D when `(valid_from absent OR valid_from <= D) AND (valid_to absent OR D < valid_to)`. Future starts are permitted as planned relationships; they do not affect the cutover contact. AUT-641 must reevaluate effective parties on their start/end dates without replay.

- At most one OWNER, one BILL_TO and one LEASING may be active per vehicle at **any** date, including future intervals. Reject overlaps even for the same customer. Adjacent half-open intervals are valid. Other roles allow concurrent distinct customers; overlapping intervals for the same `(vehicle, customer, role)` block.
- PREVIOUS_OWNER is history only: `valid_to` is required and on/before cutover. It never supplies the main contact or payer. An ended OWNER already preserves history; do not fabricate a second PREVIOUS_OWNER row. Overlapping OWNER/PREVIOUS_OWNER representations for the same vehicle/customer block.
- Synchronize `Vehicle.customer_id` transactionally with the single active OWNER. DRIVER/USER never substitute. If the supplied parties leave no active owner while an existing main contact exists, or the active owner conflicts with an unmapped existing contact, report a reconciliation conflict. Resolve through explicit approved owner assignment/end; omission never clears or relinks. A new vehicle without owner can retain null contact.
- Owner transfer explicitly ends the old interval and creates a new party identity. It must agree with any supplied `vehicles.csv` main-customer value. No inferred end date, role rewriting or collection replacement.
- Intake suggests active BILL_TO first, otherwise LEASING. An explicit BILL_TO may differ from LEASING; that precedence is deliberate. If neither exists, AUT-638 uses the order customer's direct default bill-to, otherwise that order customer, consistently with AUT-646/649. OWNER alone is never a payer fallback. Cycles, contradictions, blocked/ineligible payers and unresolved references block financial use. Parties never rewrite customer billing relationships, an existing order's chosen payer or committed invoices.

Check timelines against untouched target parties as well as this file. Serialize by tenant/vehicle and recheck invariants under lock. Future effective-state handling is an explicit implementation prerequisite.

### `vehicle_due_dates.csv`

```csv
external_id,vehicle_external_id,kind,inspected_on,plaketten_valid_until_year,plaketten_valid_until_month,due_date,due_mileage,external_ref,station_name,notes
```

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | `VEHICLE_DUE_DATE` identity; target type fixed by kind. |
| vehicle_external_id | R id | `VEHICLE` reference in the same namespace. |
| kind | R enum | `INSPECTION_57A` or `SERVICE`. |
| inspected_on | Conditional date | Required INSPECTION_57A, actual performed date on/before both cutover_date and the extraction business date. Convert extracted_at using the approved source legal entity business timezone (AT Europe/Vienna, DE Europe/Berlin), not the execution host timezone; reject if that mapping is unknown. Blank SERVICE. |
| plaketten_valid_until_year | Conditional year | Required INSPECTION_57A, actual validity year 1900–2100. Blank SERVICE. |
| plaketten_valid_until_month | Conditional integer | Required INSPECTION_57A, actual validity month 1–12, no leading zero. Blank SERVICE. |
| due_date | O date | SERVICE only; past/future due date allowed. Blank INSPECTION_57A. |
| due_mileage | O integer km | SERVICE only; absolute odometer threshold 0–2147483647, digits only, no leading zero except `0`. Blank INSPECTION_57A. |
| external_ref | Conditional code | Required SERVICE: stable service-schedule reference unique per vehicle. Optional inspection report reference. Not an ACP ID. |
| station_name | O text | INSPECTION_57A station only; blank SERVICE. |
| notes | O multiline | Plain context; SERVICE maps to notice body. |

SERVICE requires `due_date` and/or `due_mileage`. When both exist either threshold can make that same schedule due. Kilometers are absolute, never miles or distance remaining. Miles require documented approved upstream conversion/rounding; the importer does not guess. An overdue threshold is valid and never proves completion.

INSPECTION_57A projects to existing `VehicleInspectionRecord.inspection_type = PICKERL_57A`. AUT-641 must add `VehicleInspectionRecordSource.LEGACY_IMPORT` first. Do not substitute MANUAL/EBV_IMPORTED, create an ExternalInspectionResult, claim a positive/final result or EBV acknowledgement. The canonical kind intentionally differs from the target inspection token.

The valid-until pair is the actual plate month, not the performed month or tolerance-window end. Its calendar year/month must not precede `inspected_on`'s month; discrepancies block for clarification. A real late inspection may have a validity month earlier than the next anniversary of its performed date: do not calculate a replacement. Never add tolerance months. A next-due month without an actual inspection date cannot create this row: record a blocking coverage discrepancy when that inspection scope is required, rather than inventing `inspected_on`. Existing Pickerl calculation/listing consumes the real pair with its existing rule/version warnings; this dictionary changes no legal interval rules.

SERVICE projects to VehicleNotice type SERVICE_DUE, status OPEN, title `Service`, source LEGACY_IMPORT, supplied due/reference values and notes as body. `Service` is fixed creation text; normal application i18n governs display. This file represents outstanding schedules. Completed/dismissed service evidence belongs in vehicle_notices with resolution evidence. Missing due rows do not complete schedules.

### `vehicle_notices.csv`

```csv
external_id,vehicle_external_id,type,title,body,status,due_date,due_mileage,external_ref,created_at,resolved_at
```

| Column | Value | Rule / ACP meaning |
|---|---|---|
| external_id | R id | `VEHICLE_NOTICE` identity, separate from due-date identities. |
| vehicle_external_id | R id | `VEHICLE` reference in the same namespace. |
| type | R enum | `CAMPAIGN`, `RECALL`, `REMARK`, `WARNING`, `SERVICE_DUE`. |
| title | R text | Plain title, max 255 characters. |
| body | O multiline | Plain context, never executable HTML or sending instructions. |
| status | R enum | `OPEN`, `DONE`, `DISMISSED`; never derived from due values. |
| due_date | O date | Past/future due date allowed. |
| due_mileage | O integer km | Same exact absolute-km bounds/lexical/unit rules as due file. |
| external_ref | Conditional code | Required CAMPAIGN/RECALL (campaign code) and SERVICE_DUE (schedule reference); optional REMARK/WARNING. |
| created_at | O timestamp | Actual source instant on/before extracted_at. Blank preserves unknown source creation in migration evidence; target persistence creation is import time, not fabricated source time. |
| resolved_at | Conditional timestamp | Required DONE/DISMISSED; blank OPEN. On/before extracted_at, not before supplied created_at. |

SERVICE_DUE requires due_date and/or due_mileage. CAMPAIGN/RECALL require a specifically affected vehicle and code; never expand to other vehicles using make, VIN range or text. One campaign code across different affected vehicles is valid. Due values never trigger sending, consent, tasks or automatic resolution during migration.

The handler assigns LEGACY_IMPORT. DONE means evidenced historical completion; DISMISSED means evidenced dismissal, never success. Preserve raw canonical row/resolution time; resolved user and workshop-order link stay unset with explicit legacy provenance. No fake ACP user/order or trusted actor IDs are accepted. AUT-641 must support provenance and nullable legacy actor/order semantics first. Real task completion after cutover follows AUT-642's separately audited workflow.

## References, duplicates and replay

1. Customers/vehicles precede these files. References resolve through authenticated tenant, manifest company namespace and declared type, including accepted mappings. Missing, ambiguous, privacy-skipped or foreign references block. Never repair by name, plate, VIN, email or raw ACP UUID.
2. external_id is unique per file; duplicate IDs block even for identical rows. Different files/entity types/companies may reuse an ID. Preserve case/leading zeroes. Party identity fixes vehicle/customer/role; due identity fixes vehicle/kind; notice identity fixes vehicle/type. Changing those on a mapped ID blocks; use new identity and explicit end/resolution instead.
3. Natural conflicts block: party overlap above; two inspections per vehicle on the same inspected_on, including differing validity/report evidence; duplicate `(vehicle, type, external_ref)` for CAMPAIGN/RECALL/SERVICE_DUE. Identical `(vehicle, type, title, body, created_at)` REMARK/WARNING tuples block as probable duplicates. Same-day corrections/repeated inspections need the dedicated evidence workflow; no last-row-wins. Supplied inspection report references are unique per vehicle.
4. SERVICE due rows and SERVICE_DUE notices share natural key `(vehicle, SERVICE_DUE, external_ref)`. A schedule cannot occur in both files, even with different IDs; choose one owning file upstream. Compare all natural keys against existing target records. A natural match without compatible explicit mapping is reconciliation conflict, never permission to merge.
5. Replay of accepted effective payload through `(tenant_id, entity_type, source_system, external_id)` is a no-op, including inspection/notice projections and audit/events. Write mapping and target atomically. A due mapping cannot generate a second notice.
6. Party bounds/notes and OPEN notice text/due values follow approved update_existing/fill_empty_only policy after dry-run. Inspection evidence is immutable through CSV: supplied changes block for explicit correction. DONE/DISMISSED evidence is immutable. OPEN → DONE/DISMISSED needs actual supplied resolution time and approved audited migration transition. Terminal → OPEN or terminal → different terminal blocks. Stale OPEN replay against locally resolved target reports conflict and cannot reopen it. Ownership-date edits revalidate the entire effective timeline.
7. Blank optional cells leave existing values unchanged: they cannot clear resolution data, end a party, reopen a notice or delete omitted history. Conditional blank-only rules are checked on effective values, preventing transitions around stored values. No field-clear operation is added to 1.0 or 1.1.

## Manifest control totals

Revision 1.1 adds these **required** members under `control_totals.domain_counts`: null when that file is absent; a complete closed map when listed, including header-only files. All enum keys are mandatory with nonnegative JSON integer values; unknown/missing keys fail. Counts include all logical supplied rows before apply/skips, not merely active/open records. Each map sums to its file's row_count.

```json
{
  "vehicle_parties": {
    "OWNER": 1, "DRIVER": 0, "USER": 0, "BILL_TO": 0, "LEASING": 0,
    "INSURANCE": 0, "WARRANTY_PROVIDER": 0, "SERVICE_CONTRACT": 0, "PREVIOUS_OWNER": 0
  },
  "vehicle_due_dates": { "INSPECTION_57A": 1, "SERVICE": 1 },
  "vehicle_notices": { "CAMPAIGN": 0, "RECALL": 1, "REMARK": 0, "WARNING": 0, "SERVICE_DUE": 0 }
}
```

This domain_counts fragment matches the examples below; it is not a complete manifest. The central versioned schema defines the full document. Compute file hashes from actual bytes. Null missing versus full-zero listed-empty maps never delete records. Reject these additions under 1.0 instead of accepting an unversioned extension.

## Synthetic example rows

References assume accepted synthetic VEHICLE-001 and CUSTOMER-001 mappings in one company namespace, cutover `2026-11-01`, extraction `2026-10-31T22:00:00Z`. Writers follow central CRLF rules. No real pilot-customer identity or source-specific fields appear.

`vehicle_parties.csv`:

```csv
external_id,vehicle_external_id,customer_external_id,role,valid_from,valid_to,notes
PARTY-001,VEHICLE-001,CUSTOMER-001,OWNER,2024-01-01,,Synthetic owner
```

`vehicle_due_dates.csv`:

```csv
external_id,vehicle_external_id,kind,inspected_on,plaketten_valid_until_year,plaketten_valid_until_month,due_date,due_mileage,external_ref,station_name,notes
DUE-001,VEHICLE-001,INSPECTION_57A,2026-06-15,2027,6,,,REPORT-001,Example station,Synthetic inspection evidence
DUE-002,VEHICLE-001,SERVICE,,,,2027-01-15,60000,SERVICE-001,,Synthetic service schedule
```

`vehicle_notices.csv`:

```csv
external_id,vehicle_external_id,type,title,body,status,due_date,due_mileage,external_ref,created_at,resolved_at
NOTICE-001,VEHICLE-001,RECALL,Synthetic recall,Check synthetic fastening,OPEN,,,RECALL-001,2026-10-01T09:00:00Z,
```

## Database Impact

### New Tables / Columns

| Target | Implementation prerequisite | Nullability / constraints |
|---|---|---|
| VehicleParty | AUT-641 tenant scope, composite vehicle/customer tenant FKs, role, validity, provenance, notes and external mapping | Optional dates/notes, interval/singleton checks above. |
| VehicleNotice | AUT-641 schema; AUT-642 behavior/import | Optional body/due/actor/order links subject to status/type constraints; real legacy provenance. |
| VehicleInspectionRecord | AUT-641 adds source LEGACY_IMPORT; retain PICKERL_57A/date/plate fields | Actual evidence and atomic mapping. |

### Modified Tables / Migration

This PR changes no table. AUT-641 needs an expand-only serial M3 Prisma migration. Vehicle.customer_id remains service-synchronized main contact. Tenant indexes, timeline/natural-key protection and concurrency handling must be proven before handler enablement. Unsupported domains fail before apply; no silently discarded fields. Demonstrate migrated inspection visibility in the existing Pickerl list.

### Deletion Policy Impact

AUT-641 must extend [deletion policy](../../../deletion-policy.md) for the new entities before shipping: preserve imported history/mapping audit; end validity or resolve notices instead of deleting evidence. Block referenced vehicle/customer deletion subject to approved privacy/anonymization rules. This doc-only PR creates no entity/delete endpoint or new hard-delete exception.

### State / Module Impact

Tenant comes from authenticated context. Vehicle/customer identities and these relationships are tenant-wide; they grant no dealer-lot/site rights or site-owned order disclosure. No stock, ledger, fiscal record, numbering, consent or customer restriction changes. No automated reminder, email, campaign sending, OEM call or task creation. Effective owner changes and notice resolution use transactions/atomic guards; immutable invoices/history remain protected.

## API Contract Changes

No endpoint, DTO or response changes here; no OpenAPI regeneration for documentation alone. AUT-641/AUT-642 must specify authorization, party/history/notices and MCP DTOs before implementation. Reuse importer envelopes only with these exact versioned dictionaries. Any future API shape change requires committed results from `npm --prefix apps/core-api run openapi:generate` and `npm --prefix apps/core-web run api:types:generate`. Imported rows confer no MCP write authority; notice creation via MCP remains PROPOSE under AUT-642.

## UX Compliance

No UI changes here. Future panels retain top-right page actions, top-left context, standard title/subtitle classes, shared StatusBadge and query-key factories. Lists require DataTable, global visible-column search, sortable headers, row detail navigation and deletion only under policy. Complex forms use 750ms autosave with Saving/Saved/Error; isolated edits use InlineEdit on blur. Show history/import provenance and legacy resolution. Due dates remain visible/listable only. AUT-642 owns intake/tablet banners and reviewed task linkage. German-source DE/EN i18n applies to labels. Realtime needs explicit supported entity registration and frontend maps, refreshing owner/contact/notices after commit without duplicate replay events or reminders.

## Component Design

No React component changes. AUT-641 owns party/history and due display; AUT-642 owns notices, open-actions list and intake/tablet warnings. Component names/routes remain implementation concerns rather than speculative CSV fields.

## Testing Plan

Doc validation checks exact headers/dictionaries/examples, 7/11/11 cell counts, enum maps/count sums and links. No runtime tests/builds are needed for this doc-only PR.

Before handlers ship, use TDD and focused backend integration tests for:

- Exact headers/enums/scalars, revision rejection, null/default/effective-update rules and unchanged 1.0 behavior.
- All roles/kinds/types/statuses; full-zero listed maps versus absent null; hashes/logical counts, unknown/missing keys and mismatch before writes.
- Company/tenant isolation, missing/privacy-skipped references, blocked payers, customer redirect conflicts and BILL_TO over LEASING precedence.
- Overlaps including untouched records, concurrent owners, adjacent intervals, previous-owner bounds, future start/end activation and main-contact reconciliation without omission deletion.
- Actual inspection date/month, invalid/missing evidence, correct PICKERL_57A/LEGACY_IMPORT projection, no tolerance synthesis and existing Pickerl list regression.
- Zero/maximum/overdue km, negative/decimal/unsupported units, conditional fields and cross-file service duplicates; campaign code reused on different vehicles.
- Resolution timestamps, stale OPEN replay, immutable terminal/inspection evidence, duplicate IDs/natural keys and fixed-identity conflicts.
- Atomic rollback and identical replay without second party/inspection/notice/events; unsupported prerequisites without partial writes; no sending/OEM/tasks.

Future UI tests prove history/main contact/payer suggestion, open notice and provenance visibility, intake warnings and explicit task completion. Syntactic examples alone establish no production readiness.

## Open Questions and Release Gates

No open wire-format choices remain. Apply waits for AUT-641/AUT-642 models/enums, provenance/nullable legacy actors, date-effective owner handling, composite FKs/tenant checks, deletion-policy updates, importer and tests. Rehearsal must prove source coverage, payer/ownership semantics, units, mapping/replay, counts, customer restrictions and actual inspection evidence. AUT-634 DPA and all ADR-0031 legal/fiscal/cutover sign-offs remain required. Unverified evidence is a discrepancy, never fabricated success.

## References and Linear Tracking

- [AUT-647](https://linear.app/auto-core-platform/issue/AUT-647) — dictionaries; [AUT-641](https://linear.app/auto-core-platform/issue/AUT-641) — schema/parties/due prerequisites; [AUT-642](https://linear.app/auto-core-platform/issue/AUT-642) — notices.
- [Canonical CSV](migration-csv-format.md), [ADR-0031](../../01-ADR/2026-10-19-incadea-migration-hard-cutover.md), [legacy import](legacy-import.md).
- Current ACP evidence: `apps/core-api/prisma/schema.prisma` Vehicle/VehicleInspectionRecord and enums, `apps/core-api/src/vehicle/pickerl/compute-pickerl-due.ts`, existing Pickerl tests. Current source tokens are MANUAL/EBV_IMPORTED and inspection type PICKERL_57A; party/notice models and LEGACY_IMPORT remain prerequisites.


Focused boundary fixtures: owner A with driver/order customer B and no BILL_TO/LEASING must resolve B (or B's direct default), never A; inspected_on after the extraction business date is rejected even if before cutover. Include an extraction near UTC midnight to verify the declared business timezone.
