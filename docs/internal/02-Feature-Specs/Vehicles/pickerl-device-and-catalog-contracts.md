---
title: "§57a catalogue, inspector evidence and first device-import contracts"
date: "2026-10-16"
module: "Vehicles"
status: accepted
linear-project: "Austria Market Roadmap"
linear-milestone: "E5 — Digital inspection integrations"
tags:
  - feature-spec
  - pickerl
  - workshop
---

# §57a catalogue, inspector evidence and first device-import contracts

## Summary

[AUT-524](https://linear.app/auto-core-platform/issue/AUT-524) defines **three independent contracts**: C1 versioned official catalogue references, C2 inspector/Bildungspass evidence, and C3 one read-only **Workshop-Net brake-result import**. Their states remain separate: a known code does not establish qualification; a reviewed qualification does not validate a measurement; a device result does not complete an official inspection. The existing preparation checklist stays unofficial. OBFCM and emissions imports are not parallel first implementations.

This accepted spec and its [synthetic fixtures](./pickerl-device-and-catalog-contracts.fixtures.json) are the entire deliverable. No product code/schema change, device purchase, licence purchase, credential provisioning, official transmission, live provider call or deployment is authorised. No external legal approval/workshop interview becomes a new waiting gate. Each follow-up can implement its canonical parser/domain/UI with fakes immediately; missing native/licensed artifacts remain explicitly NOT_CONFIGURED, not a claim of production interoperability.

Delivery checklist: Linear CLI/current-code/primary-source research; contracts and fixtures; draft PR; GPT-6.1 Sol high posts findings; fix/re-review until clean; final-head GitHub CI; squash merge. No local tests/builds/runtime/install execution. This is SPEC FIRST; implementation plans/TDD belong to the bounded follow-ups.

## User Stories

- An advisor can see exactly which official source/version a proposed defect reference came from, without relabelling preparation points as official codes.
- A manager can review evidence of person, station assignment, training and scope and see unknown/expired/revoked status independently of an Employee role.
- A mechanic can review a brake measurement linked to the correct vehicle, order, device and time; repeated delivery creates no duplicate and no automatic pass/fail result.

## Source matrix and access boundaries

Retrieved **16 October 2026**. A protocol version is not an application release or ACP schema version. Public availability of a PDF/portal is not an API entitlement.

| Contract / primary source | Concrete evidence / missing artifact |
| --- | --- |
| C1 [RIS consolidated PBStV, §10, §17 and Anlage 6](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10012794) | Official statutory positions and possible defect groups are public HTML. The reviewed text dates Anlage 6's BGBl. II 258/2022 amendment to **2023-02-02**. This legal table is not the complete approved training/commentary catalogue required by §10(4). Freeze source/document locator, amendment, effective interval and retrieval/digest when ingesting; never call retrieval date the effective date. |
| C1 [EBV catalogue description](https://services.automotive.at/werkstatt-connect/) | Provider advertises the approved Bundesinnung catalogue and updates. No public machine-readable licensed full catalogue/version feed or redistribution entitlement is established. Required: licensed dataset/layout, version/effectivity manifest, stable entry IDs, vehicle applicability, source-change semantics and permitted storage/display scope. No subscription content scraped or copied. |
| C2 [KFG §57a(2b)](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Artikel=&Gesetzesnummer=10011384&Paragraf=57a), [PBStV §3 via consolidated RIS](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10012794), [WKO qualification guidance](https://www.wko.at/paragraph-57a/voraussetzungen-und-qualifikation-zur-ueberpruefung) | Bildungspass/training and suitable-person requirements are distinct from employee roles; recurring training and station/person scope matter. No public person lookup API or certificate signature schema is evidenced. Required for automated verification: issuer interface/version, identity/assignment mapping, scopes, validity/revocation semantics and sanitised positive/expired/revoked examples. First slice uses explicit documentary evidence review, not a fictitious live register lookup. |
| C2 [EBV support FAQ](https://services.automotive.at/) | Describes authority assignment of suitable persons and synchronisation with ZBD. Does not make ACP HR data evidence of that assignment or expose a public qualifications endpoint. |
| C3 [Workshop-Net viewer](https://workshop-net.net/viewer/), [device manufacturer integration description](https://www.hella-gutmann.com/de/for-workshops/support-informationen/workshopnet) | XML result protocols and DMS/device exchange including brake benches are advertised. This supports one brake-result read boundary, not a specific available XSD/REST endpoint or German ASA-Livestream approval for Austria. |
| C3 [NETMAN manual, article 2310, pp.17–18 and 42](https://download.workshop-net.net/netman/2310.pdf) | Distinguishes service/device identifiers, payload version and encoding; diagnostic logs contain no order/result data. Exact brake XML root/namespace/schema version, export/read operation, occurrence/session/revision identity, unit/axle semantics, authenticated origin and sanitised native samples remain missing. Do not parse diagnostic logs as measurements. |
| OBFCM [provider instructions](https://services.automotive.at/obfcm/) and [Workshop.Connect guide](https://services.automotive.at/wp-content/uploads/2026/02/Anleitung_WSC_OBFCM-V3.pdf) | Provider names Workshop-Net protocol V3 for its OBFCM workflow and separate device registration/transmission. These do not establish a brake schema version. No ACP OBFCM read/upload/store interface is specified here. Its retention/objection/device-registration contract is separate; do not archive OBFCM printouts as generic workshop measurements. |

No native sample was obtained for the licensed catalogue, qualifications registry or brake XML. The canonical examples below are **ACP schemas**, not provider wire payloads. For the small public statutory-position reference slice, source facts are evidenced; full approved-catalogue completeness remains UNVERIFIED. This distinction is visible in API and UI, not hidden behind an "official" boolean.

## Current-code evidence

Baseline main `2cadebcef3d242c8cf1de89d4a2cc324be8d301a`.

| Source | Existing behaviour / gap |
| --- | --- |
| `apps/core-api/src/prisma/fixtures/pickerl-inspection-template.fixture.ts` | `PICKERL_57A_PREP` v1 has editable labels such as BRAKES; expressly "keine Rechtsliste". Preserve code/title/version and snapshots. No automatic label-to-official-code substitution. |
| Schema `WorkshopInspectionItem` / `InspectionTemplateItem` | Generic response_value/unit/passed and severity OK/ADVISORY/REQUIRED exist. They are not native device provenance or official defect groups. |
| `workshop/workshop-inspection.service.ts`, `dto/update-workshop-inspection.dto.ts` | Site-scoped checklist update currently edits passed/notes. Schema capacity alone does not establish a measurement API/parser. Reuse checklist context without writing imported evidence over these fields. |
| Schema Employee, `employee/employee.service.ts` | Tenant-wide HR roles MECHANIC/SERVICE_ADVISOR/PARTS_CLERK, activity and optional user link; no education, station authority, course validity, calibration or device interface model. Product role authorisation and professional qualification are separate. |
| `vehicle/pickerl/compute-pickerl-due.ts`, existing Pickerl history | Reuse existing due rules. This spec does not change due dates, issue a plate or duplicate commercial-vehicle intervals in AUT-388. |
| [AUT-523 result exchange spec](./pickerl-external-inspection-exchange.md) | Separate EBV inbound final-result contract, currently qualification NOT_VERIFIED. These contracts can supply referenced evidence but never bypass its trusted receipt/source guards or create an official result from a measurement. |

## C1 — versioned official references

### Canonical contract `acp-inspection-catalog/1`

`loadCatalogManifest` validates a source bundle; `resolveReference(versionId, positionId, entryId, inspectionTime, vehicleScope)` returns `RESOLVED | UNKNOWN_CODE | STALE_CATALOG | OUT_OF_SCOPE | NOT_CONFIGURED`. Null entryId requests a position-only lookup (no finding/group recommendation); non-null entryId requires an exact sourced entry and applicable vehicle scope. First deliverable is the public RIS **statutory reference subset** plus fixture-only full-catalogue shape. The full approved-catalogue mode remains NOT_CONFIGURED without licensed content/manifest. A RESOLVED statutory position is never presented as proof that all approved-catalogue requirements were met.

| Field | Required semantics |
| --- | --- |
| `schema_version`, `source_kind` | Exactly `acp-inspection-catalog/1`; kind `STATUTORY_REFERENCE | APPROVED_CATALOGUE | TEST_ONLY`. TEST_ONLY cannot enter production. |
| `publisher`, `source_uri`, `source_document_id`, `retrieved_at`, `content_sha256` | Attribution, exact source/amendment/section or licensed bundle; server-computed bytes digest. URL alone does not certify content, nor allow arbitrary server-side fetch. Only allowlisted official/licensed sources. |
| `source_version`, `valid_from`, `valid_to` | Immutable source version and effective date interval `[from,to)` in Europe/Vienna calendar dates. valid_to null means no known end, not automatically current. Local version identifier cannot masquerade as a publisher version. Manifest includes `verified_current_at` and `recheck_after` (at most 30 days later); once elapsed, current use is STALE_CATALOG until new source review. Historical lookup uses its evidenced effective interval and preserves source-as-known-at-review. |
| `position_id`, `entry_id`, `label`, `allowed_groups`, `vehicle_scope` | Official position ID exactly from source; individual defect entries need distinct source locators/IDs because one position has several defects/groups. No generated local ID is labelled an official defect code. Allowed source groups retained verbatim, never converted from OK/ADVISORY/REQUIRED. Exact applicability must be sourced; unknown vehicle category => OUT_OF_SCOPE for official recommendation. |
| `coverage`, `rights`, `approval_evidence_ref` | Coverage `SUBSET | COMPLETE`, permission for storage/display, approval reference nullable for statutory subset. No official completeness/approval claim from a locally reviewed extract. Licensed comments remain unavailable when rights absent. |

Example source position **0.1**, label **Kennzeichen(tafeln) (falls vorgeschrieben)** is evidenced in RIS Anlage 6. The fixture copies this short position label, not a paid catalogue or an invented defect code. A selection references source/version/position/entry with source locator and group choices; the human inspector chooses any actual finding/severity. First subset contains no claim of complete defect-entry coverage. An unknown code is rejected as an official reference while existing preparatory text stays editable/unofficial.

Immutable versions never update previously accepted finding snapshots. New versions are staged then human-reviewed/activated, retaining prior versions. Unknown effective interval, overlapping applicable approved versions with no authoritative precedence, revoked approval/rights or stale currentness => unresolved warning and no new official recommendation. Ordinary preparation work continues. Do not silently choose latest retrieval or rewrite old findings after an update.

## C2 — inspector evidence, not automatic qualification

### Canonical contract `acp-inspector-evidence/1`

`reviewInspectorEvidence` stores an append-only document-evidence revision; `assessEvidence(person, station, vehicleScope, inspectionTime, asOf)` returns a documented **support state**, never an official appointment/authorisation decision. Native register adapter is absent and NOT_CONFIGURED. A manager review can establish `EVIDENCE_REVIEWED`, not `REGISTRY_VERIFIED` or "certified by ACP".

Fields: schema/source version; issuer and authoritative person reference; local Employee relation verified by OWNER/ADMIN; station/issuing authority and assignment reference; supported vehicle classes/weight/brake-course scopes; training completion and next-due date; any explicitly evidenced continuation interval; effective-from/exclusive-until bounds, withdrawal/suspension evidence; restricted document object reference + digest; verified source provenance; reviewer/time and superseded evidence ID. References max128, scope list max32, ISO dates strict. Missing validity or applicable scope is UNKNOWN, not unlimited. Employee name matching alone cannot bind an external person ID; duplicate/ambiguous identity mapping blocks assessment.

Two independent outputs: `evidence_review=UNREVIEWED | EVIDENCE_REVIEWED | SOURCE_CONFLICT` and `temporal_scope=CURRENT | CONTINUATION | EXPIRED | NOT_YET_VALID | OUT_OF_SCOPE | REVOKED | UNKNOWN`. Evaluate both at inspection time and at current review time; a now-expired proof does not rewrite the historical source record as invalid, and a future renewal does not retroactively qualify an earlier inspection. Station assignment and training must each cover inspection time. Revocation uses its evidenced effective time, not retrieval time. Contradictory same-version proofs remain SOURCE_CONFLICT; different revision does not prove it supersedes a revocation.

Source guidance describes a three-year training cycle and limited continuation. Do not hardcode `training + 3 years = fully qualified` or silently extend every expired record. First implementation records the next-due/continuation/expiry dates and source rule version **from reviewed evidence**; if absent return UNKNOWN and show the missing artifact. CONTINUATION is visibly distinct from CURRENT and is available only with explicit applicable evidence, never a generic four-month override. No boolean self-attestation upgrades unknown/expired proof. The manager's review verifies the document association and stated scope; it does not certify physical presence, driving entitlement or all other statutory conditions. These remain a human assessment.

Source review freshness: require a `review_valid_until` instant no more than 30 days after source review for a current recommendation; stale review gives UNKNOWN even if document dates remain future. Preserve the known validity reason alongside freshness (e.g. EXPIRED + stale review) instead of relabelling an expired proof current. Native automatic refresh/revocation is not claimed. A new human evidence review appends a revision and cannot delete earlier revocation/conflict evidence without an evidenced supersession link.

For AUT-523, supply an optional `qualification_evidence_ref` and support state only after exact person/station/inspection-time matching. Importing an authentic old result may remain allowed by AUT-523 while qualification remains NOT_VERIFIED; these fields cannot forge ZBD acknowledgement or retroactively block storing external history. Future official-work readiness requires reviewed, scope-valid evidence and explicit human assessment; no official finalisation endpoint is added here.

## C3 — first device path: brake-result read import

### Selection and missing native binding

Choose exactly one boundary `WORKSHOP_NET_BRAKE_RESULT_READ`: one final static service-brake measurement session from a configured workshop-network result source, **M1 two-axle vehicles only**. No live-stream control, device commands, brake-test triggering, emissions, tachograph or OBFCM ingestion in the first slice. Native brake schema/transport/version remains UNKNOWN until the source-matrix artifacts are supplied. Do not equate NETMAN application release, an OBFCM V3 requirement, a DID or a German validator result with the brake payload contract. No local bridge/NETMAN installation in this task.

`readMeasurement(connection, nativeReference)` returns `RESULT | NOT_FOUND | ERROR | NOT_CONFIGURED`; production preview accepts references only, not browser-authored provenance/values. The future profile must identify exact read/export mechanism, versioned XML XSD/namespace, byte encoding, authenticated origin/connector identity, stable measurement/session/revision ID, per-wheel unit semantics and device operating range. Require sanitised native samples for success, replay and malformed/partial result plus legitimate SDK/usage rights. Until available, canonical fixture parsing/fake transport can be implemented; native read remains off. No guessed TCP service/REST route or XML tag is supplied.

### Canonical contract `acp-brake-measurement/1`

| Field | Required mapping / validation |
| --- | --- |
| `schema_version`, `native_schema_version`, `profile_digest` | ACP version exact; native version/profile supplied by trusted adapter, allowlisted against configured source. TEST_ONLY fake profile never enabled in production. |
| `source_system`, `source_instance_id`, `measurement_id`, `revision` | WORKSHOP_NET and persistent source-instance/session IDs from documented native semantics; no filename/current time as identity. Reconnect/connector replacement keeps source-instance identity; changing connector credentials cannot reset deduplication. |
| `previous_measurement_ref` | Nullable prior native measurement ID under the same tenant/source-instance. A re-test uses a new measurement ID and links only an existing same-vehicle/order/device measurement; validate this relationship server-side. It never declares a corrected revision or supersedes original evidence. |
| `device_serial`, `device_model`, `device_software_version` | Snapshotted from trusted adapter and mapped registered device. Serial is required; DID/service/location identifiers are supplementary, not interchangeable with device serial. Device-site/connection binding has a revision; no unverified arbitrary serial accepted from browser. |
| `vehicle_vin`, `workshop_order_ref`, `session_ref` | Exact tenant vehicle VIN and native order/session reference mapped server-side to the persisted active-site workshop order. First-slice VIN 17 characters, trim/uppercase only; class M1 and exactly two axles supplied by reviewed target/profile metadata, not inferred from missing class fields. No plate-only/fuzzy matching, no relinking to another vehicle/order after import. |
| `measured_at`, `received_at`, `finality` | Measurement instant requires explicit offset/Z, preserved and UTC; receipt time from server. Source `FINAL` required for application. Over five minutes in the future is invalid; measured before the known session start is rejected. First-slice freshness policy 24h at preview and apply; older is STALE_MEASUREMENT and retained only as quarantined evidence. These are operational limits, not statutory thresholds. |
| `test_kind`, `wheels` | `SERVICE_BRAKE`, four unique `(axle=1|2, side=LEFT|RIGHT)` readings. Each `{force, unit}` uses nonnegative decimal string up to three fraction digits, unit exactly `kN`; no commas, NaN, exponent or silent N/daN conversion. Preserve zero as a value, null as missing. Missing wheel or unsupported unit rejects complete apply. |
| `device_range`, `device_evidence_ref` | Source-evidenced min/max/range and unit; force beyond range => IMPLAUSIBLE_MEASUREMENT, no recommendation. Missing range, calibration/maintenance applicability or expired/unknown device evidence => UNCONFIRMED_DEVICE. Do not invent legal calibration periods. Technical plausibility is not braking efficiency or an official pass/fail threshold. |
| `native_result_ref`, `raw_sha256`, `canonical_sha256` | Restricted source proof reference and server-computed digests. Native bytes kept separately under authorised retention; native XML processing disables DTD/external entities/network access, limits depth/size and rejects unknown namespace/version. Logs/ZIPs/OBFCM attachments are not valid brake data. |

Canonical JSON: strict UTF-8, max256 KiB, one session, duplicate keys/unknown properties rejected, max128 references, max four wheels, no arbitrary URLs/archives. It is ACP's format, **not a claimed Workshop-Net native fixture**. The fixture's synthetic forces are engineering examples, not legal acceptance limits. Do not derive a catalogue defect, set checklist passed/severity, update odometer/Pickerl due, allocate a plate or create an AUT-523 official result from forces.

### Import states, replay and concurrency

`RECEIVED -> REJECTED | QUARANTINED | READY_FOR_REVIEW -> APPLIED`. Missing native binding returns NOT_CONFIGURED before source access. Missing device evidence, partial/unconfirmed finality, stale data or unknown target metadata quarantines; malformed version/unit/identity rejects. Human review cannot edit source values or upgrade missing provenance; obtain correct evidence/new measured session instead.

Preview freezes target VIN/order/site/session revision, device binding/evidence revision, payload/profile digest and freshness, with 15-minute expiry. Human apply rechecks active TenantMember/SiteMembership, Site, target and connection under transaction/locks and uses fingerprint/CAS; invalidation => 409 REVIEW_REQUIRED with zero domain effect. A quarantine record is never an applied measurement. Measurement applies as immutable **supporting evidence only**; C1/C2 status never blocks preserving correctly bound technical evidence, but current recommendations show their independent missing/expired warnings.

Dedup unique `(tenant_id, source_system, source_instance_id, measurement_id)` binds exactly one vehicle/order/session/device; revision is **not** part of this identity. Lock this shared identity before target/order locks, so parallel different targets cannot both claim it. Same identity/revision/semantic digest returns existing result after current authorisation checks. Canonical digest uses stable property ordering, retains numeric value/unit/measurement time/source provenance, excludes retrieval time and transport whitespace. Same identity/different payload or revision => 409 MEASUREMENT_CONFLICT, append redacted evidence event; never overwrite/move the original. Explicit re-test has a new source measurement ID and reference to previous measurement, retains both and needs new human review; first slice does not auto-pick "best" or latest values. Corrected native revisions remain quarantined until a separate evidenced correction contract. No random local ID regeneration bypasses replay.

## Account, tenant, site and human boundaries

Tenant comes from auth. Catalogue source bundles may be public global reference data, but licences/activation/finding snapshots are tenant-owned; never share paid content across tenants. Qualification evidence links a tenant Employee and site/station assignment, and is restricted HR evidence. Device sources/results are operational site-owned. Every lookup/include/count uses explicit tenant filter and authorised persisted site for operational data. A query-string site/switcher is not authorisation; no caller JSON can override source account/device/person binding.

Catalogue activation and qualification evidence review: interactive OWNER/ADMIN only. Source configuration/secret management: OWNER/ADMIN; qualification documents visible only to those roles (a mechanic may see own minimal status). Measurement preview/apply: interactive OWNER/ADMIN/SALES or an authenticated MECHANIC whose linked employee is active and assigned to that persisted workshop order/task, plus active membership at that site; technical connector service may stage evidence only. Cross-tenant/site/foreign record =>404, missing active-site context =>422, role failure=>403. Identity conflicts disclose no other vehicle/employee details. Agent may suggest a reviewable draft only through the existing AgentProposal queue; these apply/activation/review actions remain HUMAN_ONLY and excluded from agent auto-apply. None performs an official inspector appointment, final finding or transmission.

Secrets stay account/connector-scoped secret-manager references, never in DTOs/logs/fixtures. Default-off native source flags and network allowlists, verified TLS and authenticated origin. No arbitrary cloud calls to a workshop private address; any later bridge needs its own authenticated deployment contract. Raw source files and inspector documents never go to Jev/LLM. API evidence downloads use existing authorised storage, not public links. Only synthetic test identities and "pilot customer" in repo/Linear.

## Database Impact

### New Tables / Columns (follow-up only)

| Contract / model | Fields and constraints |
| --- | --- |
| C1 `InspectionCatalogueVersion`, `InspectionCatalogueEntry` | Immutable source manifest, kind/coverage/approval/rights, effective interval, freshness and digest; source version + entry locator unique. No overwrite on update. Tenant activation/entitlement relation. |
| C1 `InspectionFindingReference` | Tenant/site/workshop inspection, catalogue version/position/entry and label/group/provenance snapshot, human selected finding and audit. Never changes preparation labels/codes. |
| C2 `InspectorEvidenceRevision` | Tenant/person/Employee, site/station/issuer/scope/time/withdrawal/training references, document/digest, review state and actor, predecessor/supersession evidence. Append-only; binding and applicable scope required for assessment. |
| C3 `InspectionDeviceSource`, `InspectionDeviceEvidence` | Tenant/site/device/source-instance binding, profile/version, range/calibration evidence effective interval/revision, secret reference and active/default-off flag. Deactivation does not erase history. |
| C3 `InspectionMeasurementIdentity`, `InspectionMeasurementImport`, `InspectionMeasurement` | Tenant/source-instance/measurement identity unique, immutable vehicle/order/device binding; import state/fingerprint/review expiry; immutable applied session/forces/proof, revision/digests and human actor. Composite tenant FK enforces identical target ownership. |
| All `InspectionSupportEvent` | Append-only tenant/site/contract/object/source-digest event, actor/time, reason and redacted conflict/review history. Do not create another proposal queue. |

### Modified Tables

Optional reference relations on WorkshopInspection; existing generic passed/unit/severity fields stay local/manual. Employee remains HR master, no `isQualified=true` field and no automatic role conversion. Public statutory tables never become tenant-pooled private licence data. No VehicleInspectionRecord, due rule or AUT-523 official-source enum change in these slices. Use expand-only migrations, tenant/site composite relations, sorted locks/CAS, batch reads and chunked transactional writes; no awaited query per wheel/entry. On implementation generate Prisma and tenant-restore SQL, include restore/export ordering and source-version dependencies. No schema change/generation is performed here.

### Deletion Policy Impact

At implementation update `docs/deletion-policy.md`: referenced catalogue versions/entries and applied source/device/qualification evidence are immutable or deactivated, never cascaded by editing/deleting a preparation checklist, Employee, Site or WorkshopOrder. Block parent hard-delete while retained evidence exists; existing checklist cascades must not erase these independent records. Corrections/revocations append events; deletion cannot remove a replay lock or turn expired/unknown evidence current.

Unapplied previews/raw rejected uploads purge after30 days from creation, unless unresolved conflict/legal hold requires preservation. Minimal measurement identity/digest/conflict tombstones remain while the associated order/results are retained, preventing replay after purge. Applied measurements and source proofs follow the existing documented workshop/inspection record retention and legal-hold policy, with explicit per-class retention configuration before live ingestion. Qualification documents are restricted HR evidence with separate minimisation/revocation/retention policy; never inherit public catalogue or raw OBFCM storage. Retain required historical evidence refs/digests and reviewed scope, erase unnecessary document PII through audited retention. No new statutory duration is invented and no indefinite raw-document archive is authorised. Tenant restore must preserve identity bindings, revoked/conflicting states and licences without re-enabling secrets/native connections.

## API Contract Changes

### New Endpoints (future ACP routes)

| Method / route | Contract / result | Auth |
| --- | --- | --- |
| POST `/api/inspection-catalogues/preview` then `/:importId/activate` | C1 source manifest reference => staged version; human fingerprint activation | OWNER/ADMIN, tenant rights |
| GET `/api/inspection-catalogues/references` | C1 version/position/entry/scope/time; resolution + source kind/coverage and currentness | Tenant workshop readers with entitlement; no private source data leak |
| POST `/api/employees/:employeeId/inspection-evidence` | C2 authorised document reference + declared scope/dates => UNREVIEWED immutable revision | OWNER/ADMIN, Employee and station/site scoped |
| POST `/api/employees/:employeeId/inspection-evidence/:id/review` | Exact digest + evidence version + review decision; no official-qualification boolean | OWNER/ADMIN human |
| GET `/api/employees/:employeeId/inspection-evidence/assessment` | C2 station/scope/time => separate review/temporal/freshness states | Restricted HR roles or own minimal status |
| POST `/api/workshop-orders/:orderId/measurements/preview` then `/:importId/apply` | C3 source reference, expected task/session => review snapshot; fingerprint apply | Human measurement permission above |
| GET `/api/workshop-orders/:orderId/measurements` | `{ data, meta }`, page/limit max50, sanitised forces and provenance | Persisted-site/order authorised readers |

No provider API route, official finding finalisation, device command or OBFCM send endpoint is introduced. All list endpoints paginate max50; resolve requests cap50 codes. Stable errors: 422 NOT_CONFIGURED / UNKNOWN_CODE / STALE_CATALOG / OUT_OF_SCOPE / UNSUPPORTED_SCHEMA_VERSION / UNSUPPORTED_UNIT / VEHICLE_IDENTITY_MISMATCH / DEVICE_BINDING_MISMATCH / IMPLAUSIBLE_MEASUREMENT; quarantine reasons include STALE_MEASUREMENT / UNCONFIRMED_DEVICE / QUALIFICATION_UNKNOWN / QUALIFICATION_EXPIRED as independent support status. Qualification expiry does not discard an otherwise valid raw brake import. 409 REVIEW_REQUIRED / MEASUREMENT_CONFLICT / SOURCE_CONFLICT; malformed JSON/XML400, size413, source timeout502 (unknown retrieval outcome, no applied evidence). Duplicate apply returns200 existing immutable result. No force-apply/receipt-edit endpoint.

### Modified Endpoints / OpenAPI Regeneration

Follow-ups extend workshop read DTOs with separate support refs/statuses; generic checklist PATCH cannot mutate source evidence, catalogue provenance or qualification status. Employee ordinary DTOs never reveal documents. Regenerate/commit backend OpenAPI and frontend generated types on actual DTO/controller changes. This documentation PR changes neither generated artifact.

## State Machine & Transitions

C1 stage -> validate -> human activate; immutable versions supersede by explicit source interval, while reference resolutions can become stale without mutating historical snapshots. C2 evidence append -> human document review -> time/scope/freshness assessment; expiration/revocation does not delete evidence. C3 uses its independent import lifecycle above. Overall support-readiness is a vector, not a green global pass: catalogue kind/coverage/status, qualification support and measurement status all visible. No combination automatically sets WorkshopInspection passed, makes an inspector qualified, finalises a report, sends to ZBD or changes Pickerl expiry.

## UX Compliance

Existing workshop task/vehicle context: show separate "Preparation", "Catalogue reference", "Inspector evidence" and "Device result" sections. Standard title/subtitle, top-right actions, central StatusBadge mappings for unknown/stale/expired/conflict; no all-green official-inspection badge. Show source kind/version/effective date and coverage; unknown codes stay visibly unassigned. Expired/unreviewed evidence and unknown native format remain visible with precise reason. Hide restricted qualification documents from colleagues; show only authorised summary.

Use shared DataTable for histories, sort/search all visible fields, bounded paging and row-open-detail. No Delete context action for applied evidence. Form autosave750ms and save indicator for editable local metadata; explicit review/activate/apply buttons never run on blur/autosave. Imported force values read-only; re-test adds a new source session. Realtime domain events after commit invalidate existing workshop/employee query factories by tenant/site and privacy scope; register entity/event mapping in implementation and never broadcast raw proofs/secret refs. No new standalone dashboard or qualification queue.

## Component Design

Three adapters/services and their validators: catalogue manifest/reference resolution, document-evidence assessment, brake-result read/import. Shared tenant/site/storage/audit services remain shared; domain services enforce all guards. C1 selection and C2 status widgets plus C3 measurement preview reuse workshop context and generated API types. No new TypeScript components or code in this PR.

## Testing Plan

### Backend E2E

Canonical [fixtures](./pickerl-device-and-catalog-contracts.fixtures.json) are synthetic, TEST_ONLY profiles cannot enter production, and native conformance is explicitly unverified. Each follow-up uses Red-Green-Refactor and existing source test patterns without treating existing tests as proof.

- C1 source/effectivity/rights/kind distinctions, stale/current/historical versions, unknown code and overlapping applicability; unchanged preparation labels, no auto-group/severity or paid-content leakage.
- C2 Employee role alone, unknown document/identity, expired/future/continuation evidence, station/vehicle scope, historical versus current assessment, revocation/supersession conflicts, stale source review and privacy.
- C3 wrong VIN/order/site/device, unit/native version, future/stale/incomplete/implausible result, expired/unknown device evidence, exact replay and conflicting revision, parallel different targets, stale preview/revoked membership and a genuine re-test with retained originals. Prove zero device commands/OBFCM transmissions/finalisations; checklist/official result/due unchanged.
- Cross-contract concurrency: activation/evidence/binding changes during preview invalidate review; retention/restore preserves audit/replay. A retired catalogue or now-expired inspector does not rewrite historical imported results.

### Frontend

Verify three independent statuses, source/coverage/effectivity, expired qualification visibility without declaring a legal decision, immutable measurement review/re-test and no finalisation buttons. Source fixtures/CLI inspection are not live acceptance. GitHub CI validates this docs PR; no local runtime/tests/builds.

## Open Questions and bounded follow-up slices

1. **C1 implementation:** statutory subset manifest and exact reference selection with provenance/rights/version states; full licensed catalogue parser only with supplied dataset contract. Test unknown/stale/overlap and preparation preservation. Native licence/data access is separate from parser work; do not create a commercial subscription as a ticket side effect.
2. **C2 implementation:** restricted document evidence/review and time/scope assessor; no registry adapter until a versioned issuer interface/sample exists. Test role/identity/expired/revoked/historical states. Real certificate/register access is a separate live-verification prerequisite, not a new legal approval gate.
3. **C3 implementation:** one brake canonical/fake importer, source binding/identity, human preview/apply and provenance display. Native XML mapping enabled only against exact schema/profile/sanitised samples; separate legitimate NETMAN/device access and explicit live-probe authorisation. No hardware procurement or network installation in parser work.

These are proposed technical scopes, not new implementation issues created by this spec. OBFCM application/data handling, owner objection, registered-device linkage and official submission need a separate later source contract; existing provider workflow continues outside ACP. AUT-523/AUT-533 remain the only specified inbound official-result path. AUT-388 owns commercial-vehicle intervals, tachograph and speed-limiter due rules; no duplication. No ADR needed because domain, site and AgentProposal architecture remain intact.

## References

Primary sources, access limits and retrieval date appear in the source matrix. [Existing Pickerl due-date spec](./pickerl-57a.md), [AUT-523 external-result spec](./pickerl-external-inspection-exchange.md), `docs/deletion-policy.md`, ADR-0022 site scope and current-code paths above supply repository context.

## Linear Tracking

| Field | Value |
| --- | --- |
| Project / milestone | Austria Market Roadmap / E5 — Digital inspection integrations |
| Spec / parent | [AUT-524](https://linear.app/auto-core-platform/issue/AUT-524) / [AUT-509](https://linear.app/auto-core-platform/issue/AUT-509) |
| Adjacent result path | [AUT-523](https://linear.app/auto-core-platform/issue/AUT-523), [AUT-533](https://linear.app/auto-core-platform/issue/AUT-533) |
| Excluded intervals | [AUT-388](https://linear.app/auto-core-platform/issue/AUT-388) |
