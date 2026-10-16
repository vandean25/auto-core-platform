---
title: "§57a external result exchange: first EBV inbound slice"
date: "2026-10-16"
module: "Vehicles"
status: accepted
linear-project: "Austria Market Roadmap"
linear-milestone: "E5 — Digital inspection integrations"
tags:
  - feature-spec
  - vehicle
  - pickerl
---

# §57a external result exchange: first EBV inbound slice

## Summary

[AUT-523](https://linear.app/auto-core-platform/issue/AUT-523) specifies exactly one first path: **inbound final inspection-result retrieval from EBV's DMS integration**, through the ACP port `EBV_DMS_RESULT_READ`. This is an engineering boundary, not a claim that a public EBV API schema is available. The reviewed public sources establish integration capabilities but do not publish the versioned result payload, final-status semantics or native field mapping needed for a production parser. Those missing artifacts are enumerated below. [AUT-533](https://linear.app/auto-core-platform/issue/AUT-533) can implement the canonical parser/fake adapter and review/apply domain now; native mapping stays default-off until its contract bytes are available.

Accepted is the spec status. This PR adds documentation and synthetic fixtures only. No amtliche Gutachtensmeldung, real provider call, credentials, customer message, production migration or deployment is authorised. MANUAL history and the expressly unofficial preparation checklist remain separate. No external legal approval or workshop interview is introduced as a waiting gate. Official catalogue/qualification and device/OBFCM contracts belong to AUT-524; no catalogue codes or inspector credentials are invented here.

Delivery checklist: Linear CLI/source/primary-source research; accepted spec and fixtures; draft PR; GPT-6.1 Sol high review comments, fixes and re-review until clean; final-head GitHub CI; squash merge. No local test/build/runtime/install execution.

## User Stories

- An advisor reviews one externally supplied final result against the intended vehicle and inspection station before applying it once.
- An authorised manager can distinguish external provenance and its confirmation evidence from a manual date entry or preparation checklist.
- An operator can replay an import safely, investigate contradictory data and see NICHT_BESTÄTIGT instead of an invented official success.

## Public evidence and selected path

Retrieved **16 October 2026**. Product versions, protocol versions and ACP schema versions are different identifiers.

| Primary source | Evidence / limitation |
| --- | --- |
| [EBV provider product information](https://services.automotive.at/werkstatt-connect/) | Advertises DMS integration and inspection management. Does not publish a result-read API, export schema or authentication specification. This is a capability, not a deployable contract. |
| [EBV public login](https://ebv.automotive.at/) | Authenticated portal, labelled EBV 2017; public page reports application V11.0.9757. This is not an interchange schema version, API endpoint or permission to automate the portal. |
| [EBV provider data inventory](https://services.automotive.at/ebv-datenschutz/) | Describes inspection outcome, vehicle data, plate colour/number and ZBD report number, plus identifiers supplied through synchronisation. Establishes field concepts, not wire field names, finality codes or a result export format. |
| [WERBAS integration description](https://www.werkstatt-software.at/schnittstelle) | The integrator describes its own EBV 6.0/2017 vehicle handoff and result readback to update dates. This is primary evidence for that integration's behaviour, not an ACP API entitlement or shared schema. |
| [EBV provider support information](https://services.automotive.at/) | Describes state-authority assignment of suitable persons and access onboarding. Employee role cannot establish qualification. No native result schema is supplied. |
| [BMK circular GZ 2023-0.215.358, 4 April 2023, p.3](https://www.vecos.biz/wp-content/uploads/2024/02/Erlass_OBFCM.pdf) | Names ZBD interface **V10.1** for inspection programs, in historical OBFCM context. It does not publish that interface's schema or establish its current version/ACP access; OBFCM and result import remain distinct. |

**Decision:** use only the EBV DMS **readback** boundary for one result occurrence; no direct ZBD integration, VECOS adapter, portal scraping or legacy local-folder integration in the first slice. A result returned by EBV is not by itself proof of ZBD acceptance. ACP canonical schema `acp-inspection-result/1` is specified here and is not labelled as EBV XML/JSON or ZBD V10.1. There is no evidenced native request/response fixture to copy, so use the explicit missing-artifact outcome permitted by AUT-523 rather than guessed routes or payload fields.

### Exact missing native artifacts

| Artifact | Implementation consequence |
| --- | --- |
| EBV DMS result-read contract: version identifier, transport/operation, auth, station/account scoping, result/revision lookup and error responses | Native `fetchResult` returns NOT_CONFIGURED until configured with an evidenced profile. No inferred `/api/results` route or reuse of a human login password. |
| Versioned schema/XSD/OpenAPI or formal export layout, encoding, allowed values/units, required/null fields and sanitised result request/response pair | Do not write a purported native parser from this canonical fixture. Profile must map every required canonical field to a native field, transformation and evidence location. |
| Meaning of final/positive/negative/revoked status; stable occurrence/revision ID; correction/supersession ordering; explicit ZBD acknowledgement evidence and its provenance/authenticity | Missing/ambiguous values become UNCONFIRMED, never official success. A report number alone cannot establish acknowledgement. |
| Access rights, station/customer test entitlement, secret-manager reference and test endpoint; native replay/rate limits | Separate live-access prerequisite. Canonical/fake work requires no real credentials, vendor contact or external approval. Later live probes require explicit separate authorisation. |

Check in the eventual profile manifest, documentation provenance/digest and sanitised native fixtures in the AUT-533 follow-up. Real secrets remain outside Git. A profile is only enabled when the artifact itself supports result readback; product-name/version similarity is insufficient. Missing artifacts are a concrete engineering limitation, not a reason to mark a fake exchange as live-accepted.

## Current-code evidence

Baseline main `b16be3c4da8341b8c1c3e6ae5d7f73c7ccb73e57`.

| Source | Existing behaviour / reuse boundary |
| --- | --- |
| `apps/core-api/src/vehicle/vehicle-inspection-record.service.ts`, DTO and schema | `VehicleInspectionRecord` source enum is only MANUAL, has date/month/year, optional station text/notes, no external report, station or inspector IDs, receipt, unit/profile version or replay key. Create hardcodes MANUAL; update/delete allow record mutation. External evidence must not enter through these mutable endpoints. |
| `vehicle-inspection.authorization.ts` | OWNER, ADMIN, SALES can modify manual inspection records; this is a product permission, not a statutory qualification. Reuse human role checks for local import review. |
| `vehicle/pickerl/compute-pickerl-due.ts`, `attach-pickerl-due.ts` and due-query paths | Engine consumes date/plate expiry and sorts records; it has no official outcome/receipt semantics. Extend selection/projection safely across vehicle detail, due lists, filters and CSV; preserve existing interval/tolerance rules and warnings. Imported failure cannot be converted into a positive date record. |
| `workshop/workshop-inspection.service.ts`, schema WorkshopInspection | Site-scoped editable checklist responses and notes. They do not establish official outcome or qualified inspector. Keep preparatory records unchanged. |
| `prisma/fixtures/pickerl-inspection-template.fixture.ts` | `PICKERL_57A_PREP` v1 is an editable start checklist explicitly titled "keine Rechtsliste". No automatic official code mapping or all-pass => positive result inference. |
| Existing tenant/site/domain and AgentProposal services | Reuse domain transactions and existing proposal queue if later needed. Apply is HUMAN_ONLY, excluded from agent auto-apply; no second queue or autonomous official transmission. |

Read paths in the existing inspection-record service sometimes rely on Prisma tenant context after vehicle validation. New adapter/domain queries must explicitly include authenticated `tenant_id` on every tenant-scoped lookup and relation. Do not copy omissions into new code or claim this documentation fixes them.

## Canonical interface and field mapping

Port `fetchResult(connectionContext, nativeResultReference)` is read-only; native request reference syntax belongs to the evidenced profile. It returns `{ status: RESULT | NOT_FOUND | ERROR | NOT_CONFIGURED, envelope? }`. No method in this slice creates a report, uploads a final result to EBV/ZBD, allocates a plate, reserves an inspection or registers a device. Fixture transport has no network access. The application orchestrates `previewImport` then explicit `applyImport` separately.

The [fixture file](./pickerl-external-inspection-exchange.fixtures.json) supplies concrete canonical request/result examples. `acp-inspection-result/1` is strict UTF-8 JSON, one result per envelope, maximum 256 KiB, no archive, URL or executable attachment. Reject duplicate JSON keys, unknown properties, invalid encoding, unbounded strings and non-finite numeric inputs; maximum 128 characters per reference and 17 for first-slice VIN. No PDF/OCR/LLM extraction fallback. Native adapters must first validate their actual schema and then produce this envelope; canonical upload is fake-only, not a trusted production ingestion shortcut.

| Canonical field | Source concept / validation / destination |
| --- | --- |
| `schema_version` | Exactly `acp-inspection-result/1`; unknown versions rejected. Separate `source_schema_version` identifies the evidenced native schema, not portal release. Store both. |
| `source_system`, `source_account_ref`, `source_station_id` | EBV and connected account/station identifiers. Backend resolves an active connection mapping to authenticated tenant, legal entity and persisted operational site. Caller cannot choose authority by submitting a tenant/site string. |
| `source_result_id`, `source_revision` | Stable native report occurrence and immutable revision tokens, not upload filename/time. Opaque case-sensitive identifiers; profile defines namespace. Missing ID/revision => UNCONFIRMED and no application. |
| `occurrence_relation` | ACP-only `{ kind: INITIAL | CORRECTION | REVOCATION | UNKNOWN, predecessor: null | { source_account_ref, source_station_id, source_result_id, source_revision, zbd_report_id }, classification_evidence_ref }`. Trusted profile mapping must evidence INITIAL as a distinct inspection occurrence or CORRECTION/REVOCATION as a replacement/withdrawal; preserve the native ordering evidence reference without inventing an ordinal. INITIAL requires null predecessor; CORRECTION/REVOCATION requires a complete predecessor and evidence reference. UNKNOWN or unproven classification is UNCONFIRMED. A changed native report ID alone does not prove INITIAL. All identifiers use the same bounds as their result fields. |
| `zbd_report_id` | Nullable native ZBD report identifier; display as supplied. Presence is not a successful acknowledgement. Never generate it locally. |
| `vehicle.vin`, `first_registration_on`, `registration_plate` | Exact VIN plus first-registration date for first slice. Normalise VIN uppercase/outer whitespace only, no fuzzy OCR/plate-only matching; require unique tenant vehicle and intended target. Plate optional cross-check: a conflicting plate is a mismatch requiring rejection, not silent reassignment. Nonstandard/absent VIN is unsupported in slice one. |
| `inspected_at` | ISO-8601 timestamp with explicit numeric offset or Z; preserve supplied value, store UTC instant and derive `inspected_on` in Europe/Vienna. Date-only source cannot invent midnight/time: unsupported profile until explicitly versioned. No future inspection date. |
| `inspector.source_person_id`, `qualification_evidence_ref` | Native person reference required for apply, optional external qualification evidence; preserve reference without asserting validation. Never infer from Employee ID/MECHANIC role. `qualification_state=NOT_VERIFIED` until AUT-524 supplies a separate validated contract. No name, birthday or Bildungspass raw data in fixture/log. |
| `outcome` | ACP `POSITIVE | NEGATIVE | REVOKED | UNKNOWN`, mapped only from documented native values. This is not an official defect-code catalogue. Preserve native outcome code in restricted provenance. Unknown/unmapped stays UNCONFIRMED. |
| `plate` | Nullable object with supplied number/colour and `valid_until=YYYY-MM`. Positive apply requires supplied expiry and plate number; never infer an assigned plate from a due month or local due rules. Negative/revoked may have null plate; do not coerce null to current month. |
| `odometer` | Optional `{ value: decimal-string, unit: km }`, nonnegative decimal(12,3), no exponent or conversion; unknown unit rejected, missing remains null. Store as source evidence; never overwrite a more recent vehicle mileage automatically. No device measurement/OBFCM records accepted. |
| `finality`, `acknowledgement` | `FINAL | DRAFT | UNKNOWN` separate from receipt `CONFIRMED | UNCONFIRMED | UNKNOWN`. CONFIRMED must be generated by the trusted adapter from documented positive final receipt evidence bound to account/station/result/revision. Browser JSON asserting CONFIRMED is insufficient. Retain evidence type/ref/digest and retrieval time; do not claim ACP has authenticated a ZBD signature unless the verified profile provides it. |
| `retrieved_at`, evidence digests | Server clock UTC retrieval; original response bytes SHA-256 computed server-side, profile digest and canonical payload digest. Client-provided hash is not trusted. Source timestamps are not used to silently order revisions. |

For native fields, the mapping is intentionally **conceptual until the missing layout exists**; every wire field name remains unclaimed. `TEST_ONLY` source/profile/reference values in fixtures cannot enter production. No custom JSON envelope is represented as a native EBV export.

## State Machine & Transitions

Import lifecycle: `RECEIVED -> REJECTED | UNCONFIRMED | READY_FOR_REVIEW -> APPLIED`, plus `CONFLICT` for a contradictory existing occurrence. READY requires schema, identity/station, trusted provenance, finality and receipt checks. Human review is necessary but cannot upgrade an unconfirmed receipt or invented native profile.

1. Resolve active connection/site under authenticated tenant and active TenantMember/SiteMembership. When tied to a workshop order, derive site/vehicle from that persisted order, never a later switcher. Vehicle identity is tenant-wide; result evidence/import jobs are operational site-owned.
2. Validate bytes/schema, versions/units/time, exact vehicle/station/account/person references and result occurrence. Error has no vehicle-history, due-date or checklist effect. Rejected input is not cached as a successful result. Keep a bounded redacted attempt event.
3. UNCONFIRMED covers absent acknowledgement, native-profile ambiguity, DRAFT/UNKNOWN finality or unmapped result. It can be displayed as NICHT_BESTÄTIGT to authorised site users, but never projected into official history or due calculation. Read timeout is ERROR/UNKNOWN retrieval outcome, not a negative inspection or fictitious ZBD response; read retry cannot transmit anything.
4. READY_FOR_REVIEW freezes target, connection/site mapping revision, profile version, payload digest, source occurrence and derived dates. Preview expires after 15 minutes. Apply rechecks all guards under a vehicle lock and active Site lock, compares target vehicle identity and mapping revisions, and requires the reviewed fingerprint. Changes => `409 REVIEW_REQUIRED`, no partial application.
5. Atomically insert external result, append provenance event, update eligible due projection and mark import APPLIED. Idempotency unique key `(tenant_id, source_system, source_account_ref, source_station_id, source_result_id, source_revision)` is enforced in the database. Server canonicalises JSON object-key order; digest covers semantic fields and evidence identity, excludes retrieval timestamp and transport whitespace. Same key+semantic content returns existing APPLIED result; no second history row/event/projection. Same key+different content => CONFLICT, preserve both digests in restricted audit; never last-write-wins. A tenant-level `InspectionReportIdentity` row uniquely binds each non-null ZBD report ID to one vehicle **independent of revision, account and station**. Atomically insert-or-load and lock this shared identity before the vehicle lock (stable sorted keys if a predecessor is also referenced). A competing vehicle binding is `409 EXTERNAL_RESULT_CONFLICT`, even with a different revision/account; unique constraint and shared lock ensure parallel different-vehicle imports cannot both apply. Do not reveal the other vehicle/site in the error. Same identity with a different revision/account is investigated as a correction/duplicate, never assumed to be a distinct inspection. Keep source-occurrence uniqueness for reports without ZBD ID; those cannot qualify as confirmed positive in the first native profile until its final receipt binds an authoritative report identity.
6. Corrections/revocations are append-only external revisions with explicit native predecessor relation and evidenced ordering; never PATCH old evidence. A changed revision token alone cannot establish newer status. This first slice quarantines corrections/revocations as CONFLICT for manual investigation; no human override can apply an arbitrary replacement. Preserve previous row and show unresolved contradiction warning. Supporting correction application requires a later documented native correction contract, not a new arbitrary import key.

### Outcome, plate and due-date projection

APPLIED external results are immutable and distinguishable from MANUAL. Only FINAL + receipt CONFIRMED + POSITIVE with supplied expiry may contribute a `VehicleInspectionRecord` projection (`source=EBV_IMPORTED`, external-result relation). Validate positive expiry with existing date validator; imported dates never weaken manual validation. Keep manual rows unchanged and never deduplicate a manual row by overwriting its source. To avoid duplicate date contributions, the selection layer uses each external-result relation once and collapses equal-date/equal-expiry manual/external facts for computation only, preserving both history entries.

NEGATIVE results may be APPLIED as external evidence with confirmed provenance, **without** a new positive/plate projection or extending expiry. REVOKED/corrections use the quarantine rule above. UNKNOWN does not apply. Maintain a separate **negative-result barrier** at the latest confirmed negative inspection instant, independent of manual dates. Only a FINAL, CONFIRMED, POSITIVE external result classified by trusted evidence as INITIAL, with a distinct authoritative report identity and strictly later inspection instant, can clear that negative barrier. Equal-time conflicting outcomes remain blocked. A new/edit/backdated/deleted MANUAL row cannot establish, advance or clear this barrier. An older negative arriving after a qualifying later external positive does not regress the resolved state.

An **unresolved report-conflict barrier** is sticky regardless of later positive or manual dates. No action in this slice clears it; resolution requires the later documented correction contract and an audited resolution event. While either barrier is active return `pickerl_due.status=UNKNOWN`, warning `EXTERNAL_RESULT_REQUIRES_REVIEW`, and the prior eligible due month as historical context only. Do not show a stale green OK as roadworthiness evidence. Date selection ties with differing expiry also raise the conflict barrier; database iteration order never decides. A changed occurrence ID or revision with correction metadata cannot count as a distinct positive. Existing interval/tolerance calculations remain unchanged; due status is never an official roadworthiness certificate.

Minimal date/expiry/source and review-required summary are tenant-wide CRM vehicle facts, consistent with manual due history. **This is an explicit projection boundary**: it excludes report/station/account/person IDs, native evidence and site-owned workshop data. Raw imported records/jobs and provenance require their persisted site membership; no tenant-only includes/counts may expose them. Apply the same projection selection and warning to detail, due list/filter and CSV paths, including after tombstoning a conflicting attempt. Checklist completion and workshop order status never auto-complete from import.

## Database Impact

### New Tables / Columns (AUT-533; none in this PR)

| Model | Fields / constraints |
| --- | --- |
| `InspectionSourceConnection` | UUID, tenant, site, legal-entity/station/account binding and revision, source/profile version+digest, active/default-off read flag, secret reference. Tenant composite FKs; one station binding per account/site context. Changes invalidate previews. |
| `InspectionExchangeImport` | UUID, tenant/site/target vehicle, optional persisted workshop order, connection, lifecycle state, fingerprints, preview expiry, redacted errors and created/reviewed human actor/time. Optimistic version and one apply transition. |
| `InspectionReportIdentity` | UUID, tenant, ZBD report ID and immutable vehicle binding; unique `(tenant_id, zbd_report_id)`, unique `(tenant_id, id, vehicle_id)` for composite result FK. Shared identity lock serialises all revisions/accounts before vehicle locks. No global cross-tenant deduplication. Retain with result/conflict tombstones. |
| `ExternalInspectionResult` | Immutable UUID, tenant/site/vehicle, connection, report-identity relation, native occurrence/revision and ZBD refs, occurrence_relation, field snapshots above, finality/receipt/provenance evidence, semantic/original digests and actor/time. Compound replay uniqueness; composite report-identity/vehicle FK prevents reassignment. Native revision namespace stays profile-specific; identity ownership is independent of revision. |
| `InspectionExchangeEvent` | Append-only tenant/site/import/result correlation, previous/new state, reason/digests, actor/time. Conflict event can refer to both evidence versions without replacing original result. |

### Modified Tables

`VehicleInspectionRecordSource` adds EBV_IMPORTED; nullable unique external-result FK on projection. Manual create always MANUAL; reject external source/FK input. Manual PATCH/DELETE cannot alter/delete external projections or their evidence. Extend vehicle due projection with minimal conflict/negative summary described above; do not make required manual expiry columns nullable merely to store a failure. No retroactive conversion of MANUAL to external. External person references remain external strings, not qualification relations invented from Employees.

Expand-only migration with tenant/site foreign keys, transaction/CAS and replay race tests. Batch-load identities/connections/records, no awaited DB query per row. Reuse existing services and chunked transaction utilities. Update Prisma generation, tenant-restore SQL generator, restore/export dependencies and realtime mapping in implementation CI. No migration/generation runs in this docs task.

### Deletion Policy Impact

At implementation update `docs/deletion-policy.md`: deactivate referenced connections; no cascade from station/site/vehicle/tenant maintenance to retained external results/events/report identities. Applied results/projections cannot use manual hard delete; corrections are append-only. Block vehicle deletion while retained external evidence exists, or use established tombstone/export erasure handling without destroying the audit chain. Unapplied previews and transient raw payloads purge after 30 days from creation unless legal hold or unresolved conflict requires preservation. Preserve minimal occurrence/digest/conflict tombstones, report-to-vehicle bindings and barrier summaries while associated vehicle results remain, so replay cannot recreate a purged conflict or hide its warning. Applied source evidence follows the approved inspection-record retention/legal-hold policy; this spec invents no statutory duration or new perpetual raw-PII archive. Implement explicit retention configuration before enabling native import; no deletion based on quote-style TTL. Credentials revoke independently. No runtime entity or deletion rule changes in this PR.

## API Contract Changes

### New Endpoints (future ACP routes, never claimed provider routes)

| Method / route | Request / response | Authorisation |
| --- | --- | --- |
| POST `/api/vehicles/:vehicleId/inspection-imports/preview` | `connection_id`, native result reference, optional workshop order ID; trusted server read => 201 import state, canonical reviewed fields, fingerprint/expiry or redacted error. Production accepts no caller-supplied outcome/receipt. | Interactive OWNER/ADMIN/SALES plus active persisted site membership |
| POST `/api/vehicles/:vehicleId/inspection-imports/:importId/apply` | Reviewed fingerprint + import version; 200 APPLIED/existing result; no outbound call | Same human roles; all guards rechecked |
| GET `/api/vehicles/:vehicleId/inspection-imports` | `{ data, meta }`, page/limit 1–50; authorised-site attempts only | Vehicle read and persisted site membership |
| GET `/api/vehicles/:vehicleId/external-inspection-results/:resultId` | Sanitised provenance, result and confirmation state; evidence through authorised storage access only | Vehicle read plus result-site membership |

422 errors: `EXCHANGE_NOT_CONFIGURED`, `UNSUPPORTED_SCHEMA_VERSION`, `UNSUPPORTED_UNIT`, `INVALID_INSPECTION_PAYLOAD`, `VEHICLE_IDENTITY_MISMATCH`, `STATION_MISMATCH`, `RESULT_UNCONFIRMED`. Inaccessible foreign tenant/site/connection/result is 404; missing active-site context is 422 ACTIVE_SITE_REQUIRED; insufficient role is 403. Contradiction/replay mutation is 409 `EXTERNAL_RESULT_CONFLICT`; expired/changed preview is 409 `REVIEW_REQUIRED`. Malformed JSON is 400, oversized payload 413; provider read timeout/error is 502 with UNKNOWN retrieval outcome and no applied result. Identical replay returns 200 existing import/result after current authorisation checks. No generic force-apply or receipt-edit endpoint exists.

### Modified Endpoints / OpenAPI Regeneration

Existing inspection-record reads expose source/projection summary without restricted external identifiers; existing manual mutations reject external rows. Vehicle/detail/due/CSV responses include the defined warning/selection effect. Keep existing manual list shape compatible; new list routes use `{ data, meta }`. On real DTO/routes/Swagger changes regenerate and commit backend OpenAPI and frontend generated types. Neither generated artifact changes here.

## UX Compliance

Use the existing vehicle card and workshop context, with top-right "Import inspection result" action and a review dialog; no second preparation checklist. Header uses standard title/subtitle and central StatusBadge mapping. Show MANUAL, EBV imported/confirmed, NICHT_BESTÄTIGT and conflict separately, with supplied inspection date/plate expiry and explicit "qualification not verified". Missing confirmation cannot be fixed with a green checkbox. Show applied proof only to site-authorised users; tenant-wide due summary contains no restricted identifiers.

New history view uses shared DataTable, sortable columns, search across visible fields, bounded paging and row opens detail. No Delete context action for applied evidence. Ordinary multi-field forms keep 750 ms autosave and save indicator; review/apply requires a separate explicit button and cannot happen on autosave/blur. Real-time import/result events emit after commit, tenant/site-scoped for details; minimal vehicle projection changes invalidate existing vehicle/due query factories for tenant CRM readers. Register backend entity and frontend event/key mapping in AUT-533; no secrets/raw documents in broadcasts.

## Component Design

AUT-533 adds one read-only EBV adapter behind an evidenced profile, canonical validator, import review/apply service and a vehicle-result review/history component. Existing `VehicleInspectionRecordService` and due projection remain domain owners. Workshop checklist service remains preparatory; source binding owns protocol mapping only. The existing AgentProposal queue may later offer a reviewable draft, but import apply and any future official transmission remain HUMAN_ONLY. No components or TypeScript code are changed by this PR.

## Testing Plan

### Backend E2E

Normative [synthetic cases](./pickerl-external-inspection-exchange.fixtures.json) cover valid positive result and expected projection, negative without expiry extension, unconfirmed receipt, wrong vehicle/station, corrupt JSON, unknown schema/unit, replay and contradictory saved occurrence. Fixture labels/IDs are synthetic and use "pilot customer"; TEST_ONLY can never be a live profile.

AUT-533 follows Red-Green-Refactor: prove exact-once apply under replay/parallel requests and stale fingerprints; foreign tenant/site/account/buyer mapping and inactive membership/site; source-schema mismatch and unauthenticated receipt spoofing; imported-row manual PATCH/DELETE denial; timezone rollover, future/invalid date, missing positive plate, conflicting same-day outcomes, late older import, and warning parity across detail/list/filter/CSV. Test raw evidence redaction, retention/replay tombstones, restore and realtime invalidation. Re-reading source/tests is not proof these behaviours already pass.

### Frontend

Verify preview then explicit apply, NICHT_BESTÄTIGT/conflict blocking, provenance display restrictions, preserved manual/preparation history and no automatic outbound activity. Local runtime/tests/builds are excluded for this task; use final-head GitHub CI for the documentation PR. Future native profile tests require real schema/sample bytes; a fake server does not prove EBV/ZBD interoperability or official receipt.

## Open Questions and bounded follow-up

Product decisions are settled: one inbound EBV result boundary, no outbound draft/final transmission in AUT-533. Consequently no outbound idempotency key, send worker, official acknowledgement poll or legal-finalisation route is introduced. If a later ticket adds transmission, it must define explicit human draft review, durable dispatch and unknown-outcome reconciliation before implementation; an import is never a surrogate send.

Remaining engineering unknowns are the four exact native artifact groups above. AUT-533 can deliver fake/contract parser, persistence, review and projection tests while returning NOT_CONFIGURED for absent native binding. It must report native/live verification as missing, not call a fake-only adapter a production integration. Add native mapping only against the supplied versioned artifact; no new external legal/workshop gate. AUT-524 separately handles official codes, qualification evidence and devices/OBFCM. No ADR needed: the existing tenant/site/domain/agent architecture is preserved.

## References

- Public primary-source URLs and retrieval date are recorded in the evidence table; no third-party schema or guessed field mapping is treated as authoritative.
- [Existing Pickerl due-date spec](./pickerl-57a.md), `docs/deletion-policy.md`, ADR-0022 site scope and source paths in Current-code evidence.

## Linear Tracking

| Field | Value |
| --- | --- |
| Project / milestone | Austria Market Roadmap / E5 — Digital inspection integrations |
| Spec | [AUT-523](https://linear.app/auto-core-platform/issue/AUT-523) |
| Parent | [AUT-509](https://linear.app/auto-core-platform/issue/AUT-509) |
| Implementation | [AUT-533](https://linear.app/auto-core-platform/issue/AUT-533) |
| Separate contracts | [AUT-524](https://linear.app/auto-core-platform/issue/AUT-524) |
