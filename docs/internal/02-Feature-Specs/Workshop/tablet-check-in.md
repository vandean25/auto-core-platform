---
title: "Tablet vehicle check-in (Fahrzeugannahme)"
date: "2026-10-16"
module: "Workshop"
status: draft
linear-project: "Austria Market Roadmap"
tags:
  - feature-spec
  - workshop
  - tablet
---

# Tablet vehicle check-in (Fahrzeugannahme)

## Summary and delivery boundary

A service advisor records the vehicle's arrival condition with the customer on a tablet: mileage/fuel, visible damage and photos, accessories/keys, warning lights, an optional reception checklist, and a drawn acknowledgement. Completion freezes that evidence. The existing workshop order PDF includes the check-in section. This is a responsive web flow, not a native app.

AUT-385 is **documentation only**. The 16 October update on [AUT-385](https://linear.app/auto-core-platform/issue/AUT-385) supersedes its old discovery gate and request for 2–3 new tickets. Use the existing AUT-554–564 children of [AUT-552](https://linear.app/auto-core-platform/issue/AUT-552). No wait on AUT-390, no customer identity in artifacts, and no product implementation or migrations in this PR. Legal wording and retention below are engineering assumptions for lawyer review, not an external approval gate for those tickets.

Delivery checklist: inspect current code and linked tickets; write this contract; self-review; create draft PR; independent review and fixes until clean; use GitHub CI only; squash merge after successful CI. No local builds, tests, dependency installation, or runtime validation for this task.

## User stories

- As an advisor, I want to start from an existing intake order and show the customer what was recorded before completing it.
- As a customer, I want damage, belongings and my acknowledgement preserved without silently authorising repairs or an estimate.
- As an advisor, I want a draft and queued photos to survive a temporary connection loss without duplicate records or lost edits.

## Verified gap analysis

Inspected against main **0ebe5d8107322a4bd839c4f6623669ed22b07e6e**, 16 October 2026. References identify existing code, not evidence that this proposed feature passes runtime tests.

| Area | Existing evidence | Gap / reuse decision |
| --- | --- | --- |
| Arrival fields | `apps/core-api/prisma/schema.prisma`, `WorkshopOrder`: odometer, fuel_level, reported_issue, notes; `apps/core-api/src/workshop/dto/register-intake.dto.ts`; `workshop-intake.service.ts` | Reuse order creation, snapshot mileage/fuel in a separate check-in. No new `workshop_orders` columns. |
| Advisor intake | `apps/core-web/src/components/workshop/WorkshopOrderIntakeDialog.tsx`; `src/features/workshop/intake-form.ts` | Existing dialog is not the three-screen condition/signature flow. Extend entry points, keep normal manual intake usable. |
| Registration intake | `apps/core-api/src/registration-intake/registration-intake-apply.service.ts`; `apps/core-web/src/components/workshop/RegistrationDocumentIntakeStep.tsx` invokes `onOrderCreated(result.workshopOrderId)` | AUT-537's apply/order hand-off already exists. AUT-564 opens check-in for that returned order; never create a second order or use unconfirmed extraction data. |
| Media | `schema.prisma`, `WorkshopMedia`; `apps/core-api/src/mechanic/mechanic-media.service.ts` and `mechanic-media.storage.ts` | Metadata, scoped storage keys and signed-upload machinery exist, but APIs authorise mechanic tasks. No `purpose` or `check_in_id` today. Reuse storage primitives with advisor/order access, never fake a mechanic task. |
| Checklist | `schema.prisma`, `InspectionTemplate`, `InspectionTemplateItem`, `WorkshopInspection`, `WorkshopInspectionItem`; `apps/core-api/src/workshop/workshop-inspection.service.ts`; `apps/core-api/src/mechanic/mechanic.controller.ts` | Nullable `workshop_task_id` already supports an order-level row structurally; service/routes currently get/update task checklists. No template-management controller found. Add reception API and tenant template selection; no second checklist engine. |
| Mechanic findings | `apps/core-web/src/components/workshop/MechanicFindingAdvisorPanel.tsx`; AUT-538 | Findings remain internal advisor proposals. Check-in photos/signatures must never appear in finding-media selection or suggestion submission. |
| PDF | `apps/core-api/src/workshop/workshop-pdf.{service,types,renderer,layout,generation}.ts` | Existing `workshop-order` dispatch and mutable order PDF cache; no frozen check-in content/media or evidence PDF hash. Extend these files, no new pipeline kind. |
| Offline | Existing intake components and API hooks have no check-in IndexedDB store or photo queue | AUT-558 adds a narrow draft store, not a general PWA/service-worker project. |
| Signature/condition | `schema.prisma` has no `WorkshopCheckIn` | New reception aggregate, evidence and completion guards required. Estimate approval is a separate existing domain; reuse evidence conventions, not its public token routes. |

## Scope and decisions

1. One check-in per tenant/order, states `DRAFT -> COMPLETED`. No reopen or correction overwrite in v1. Subsequent corrections are advisor notes outside the signed record; replacing a signed check-in requires a future append-only amendment contract.
2. Start only for an order in `INTAKE` or `IN_PROGRESS`. An existing completed check-in stays readable in later order states. No automatic order status transition, task creation, estimate acceptance, invoice or notification.
3. Advisor roles `OWNER`, `ADMIN`, `SALES` may create/edit/complete/read and retrieve evidence. `TECH` cannot access signature or check-in media through mechanic routes. All calls require authenticated tenant membership and the order's active site; no public signing link.
4. Tenant comes from `TenantContextService`; site from `SiteContextService`. Missing active site is `422 ACTIVE_SITE_REQUIRED`, foreign tenant/site/order/check-in/media IDs return 404. Recheck active site and membership inside writes; lock the site row for creates/completion as in ADR-0022. Do not infer document site from a later site switch.
5. Check-in captures vehicle/customer/order display identity and versioned acknowledgement text on completion. Later edits to live master data, templates, order mileage or photos do not rewrite the record.

## Database impact (proposed, expand-only)

### `WorkshopCheckIn` / `workshop_check_ins`

| Fields | Type / rule |
| --- | --- |
| `id`, `tenant_id`, `workshop_order_id` | UUID strings; id generated once by client with shared `generateId()`; unique `[tenant_id,id]` and `[tenant_id,workshop_order_id]`. |
| `status`, `revision` | `DRAFT` default, `COMPLETED`; integer revision starts at 1 and increments atomically on draft changes. |
| `condition_json` | Validated version-1 object: `schema_version:1`, `tyre_season: SUMMER/WINTER/ALL_SEASON/UNKNOWN`, `exterior_notes`, `interior_notes` (each <=2000 chars). No arbitrary JSON properties. |
| `damage_markers_json` | Array <=50 of `{id,zone_id,type,note,media_ids}`; UUID marker id; type `SCRATCH/DENT/CRACK/OTHER`; note <=500; <=5 unique photo IDs per marker. IDs validated against this check-in's READY CHECK_IN media. |
| `odometer`, `fuel_level` | Nonnegative integer km <=9,999,999 and integer 0–100, required to complete. Initial draft copies order values, later edits change the check-in only. |
| `items_left`, `key_count`, `warning_lights` | Text <=2000; integer 0–10; unique array <=20 strings of 1–80 chars. Empty means none, never a missing answer. |
| `inspection_id` | Optional composite tenant FK to existing `WorkshopInspection`; service enforces same order and null task. Unique `[tenant_id,inspection_id]` when present. |
| `created_by_user_id`, `completed_by_user_id` | Tenant-member actor references with composite tenant constraints; completion actor nullable until complete. Preserve actor display snapshot if account erased, per existing audit conventions. |
| `signed_by_name`, `signed_at`, `signature_media_id` | Nullable in draft; trimmed name 1–200, server timestamp, composite tenant FK to signature media. Required together on completion. |
| `acknowledgement_version`, `acknowledgement_text`, `device_hash`, `ip_hash` | Frozen copy/version; SHA-256 hashes of request UA and server-observed IP with tenant-specific keyed HMAC instead of retaining raw IP/UA. No biometric stroke timing/pressure or device fingerprint collection. |
| `snapshot_json`, `content_sha256`, `completed_at` | Frozen canonical evidence, digest and server timestamp, null until completion. Snapshot includes identities, all condition fields/markers, checklist labels/types/answers/severities, ordered photo IDs + transformed-byte hashes, signature-byte hash, exact acknowledgement/name/time/actor. |
| `pdf_storage_bucket`, `pdf_storage_key`, `pdf_sha256`, `pdf_generated_at` | Nullable until final evidence PDF is durably stored; all four set once together. PDF is outside its own content hash. |
| `retain_until`, `legal_hold`, `createdAt`, `updatedAt` | Draft expiry / evidence retention deadline, false hold default, standard timestamps. Retention extension and authorised erasure metadata are exceptions to evidence immutability. |

Composite FK `[tenant_id,workshop_order_id] -> WorkshopOrder[tenant_id,id]` uses RESTRICT. There is no extra site column: site is resolved through that immutable order association and scoped in every query/include. Never allow retargeting the order while a check-in exists. A signed snapshot is not an excuse to bypass active-site authorisation on reads.

### Existing tables

- `WorkshopMedia`: additive `purpose` default `GENERAL` (backwards-compatible old writes), nullable `check_in_id`, nullable `client_upload_id`, nullable `sha256`, processing status `PENDING/READY/FAILED` for new check-in uploads. Legacy media remain available under existing rules. New purpose values `CHECK_IN`, `CHECK_IN_SIGNATURE`; check-in media have null `workshop_task_id`. New nullable unique `[tenant_id,client_upload_id]` deduplicates retries.
- Composite FK `[tenant_id,check_in_id] -> WorkshopCheckIn[tenant_id,id]` RESTRICT; signature FK back to `WorkshopMedia` RESTRICT. Create draft first, then media, then attach signature. For purge clear the nullable signature link first, remove media, then check-in. Validate same order/purpose at API boundaries; where feasible add a composite order+check-in FK and matching unique key to enforce the order identity too.
- `WorkshopInspection` and items: reuse existing nullable task relation. A check-in links a single order-level inspection, created atomically with the selected template snapshot; no new checklist entity. Add response-type/required/sort-order snapshot fields if absent so template edits cannot change completion validation. All reception and mechanic mutation paths reject modification of an inspection linked to a completed check-in.
- Add all reverse relations, indexes and nullable evidence columns in the owning implementation ticket. No destructive rename, required backfill, or change to existing order fields; old revision must remain functional while new tables/nullable fields deploy. Database checks enforce numeric bounds, allowed JSON version and completion-field consistency where expressible.

### Restore and deletion policy impact

AUT-555 must update `docs/deletion-policy.md` with check-in DRAFT expiry versus immutable COMPLETED evidence, restricted parent deletion and media retention. AUT-563 adds the completed-check-in guard to existing inspection deletion policy. This spec proposes these changes; it does not describe the new entities as deployed policy.

`tools/tenant-restore/tenant-schema.mjs` derives its manifest from Prisma/migrations. Add `workshop_check_ins` and all new FK/evidence fields to its derived coverage; regenerate `purge-tenant-data.sql` and `verify-tenant-schema.sql` via `generate-tenant-restore-sql.mjs`. Cover the signature/media cycle explicitly in export/restore/purge guards, restore parent check-ins with signature null, then media, then restore signature links. Verify cross-tenant FKs and cleanup order in CI. DB restore alone does not restore GCS objects: inventory/copy scoped photo, signature and archived-PDF bytes and verify digests, or report unavailable evidence without substituting regenerated bytes. Tenant deletion purges scoped objects, thumbnails, drafts and PDF archives through the authorised tenant purge workflow, subject to recorded legal hold handling; backups expire through documented backup policy. No cross-tenant object keys on export/import.

## API contract changes (future implementation)

Base `B = /api/workshop/orders/:orderId/check-in`. JSON DTOs reject unknown fields and validate UUIDs, ranges and lengths. Every response excludes raw storage credentials and evidence hashes used only internally; signed GET URLs are short-lived and issued after authorisation. Single-resource responses are typed objects, not list envelopes.

| Method / route | Request | Result |
| --- | --- | --- |
| `POST B` | `{id}` plus optional template id | 201 draft, or 200 same draft for a retry with same id/order. Existing order with another id: 409 `CHECK_IN_EXISTS`, return authorised existing id. Same id on another order: 409. |
| `GET B` | none | 200 record including revision, processing/PDF state and authorised media metadata; absent 404. |
| `PATCH B` | `{expected_revision, ...editable condition fields}` | 200 incremented revision. Partial update; null only for optional fields. No evidence/status/actor/storage/order identity writes. |
| `POST B/media` | multipart bytes, `{client_upload_id,purpose,expected_revision}` | 201 READY media after processing, or 200 original media for identical retry. Signature only accepts PNG, photos JPEG/PNG/WebP; no arbitrary SVG/audio/video. Server hashes upload and verifies retries have same bytes/purpose/check-in; mismatch 409 `UPLOAD_ID_REUSED`. |
| `DELETE B/media/:mediaId` | `{expected_revision}` | 204 detaches/deletes draft-owned media only; remove marker references atomically; signature link cleared if needed. Storage delete retried safely. Completed: 409. |
| `PATCH B/inspection` | `{expected_revision,items:[{id,passed,response_value,severity,notes}]}` | 200 draft revision; allow only items of the attached inspection; validate values against frozen response types. Required answers checked at completion. |
| `POST B/complete` | `{expected_revision,expected_content_sha256,signature_media_id,signed_by_name,acknowledgement_version,acknowledged:true}` | 200 frozen record; repeats of exact same completion return same evidence, conflicting payloads 409. |

`GET B` provides `review_content_sha256` for the current server-validated review data including exact acknowledgement text, proposed signer name and READY signature/photo hashes; obtain it after final autosave and signature upload, passing proposed signer name as an authenticated query parameter if needed. This preview digest excludes server-generated completion time/actor; completion compares it under lock then adds server evidence and produces final `content_sha256`. Client never supplies final timestamps/hash/IP. Validation failures use 400 with a stable field/error code; oversized media 413, unsupported or corrupt type 415, stale revision 409 `CHECK_IN_CONFLICT`, immutable writes 409 `CHECK_IN_COMPLETED`, pending uploads 409 `CHECK_IN_MEDIA_PENDING`. A signature recorded for another review revision is rejected. Signing UI clears its local signature whenever review content changes.

All draft/media/checklist writes and completion serialise on the check-in row and check revision. Every mutation increments revision, including successful media attachment/removal and checklist edits. Duplicate retries do not increment it again. Completion also locks/revalidates parent order status/site and required attachments. Batch prefetch media/template answers and validate in memory, with no awaited DB query per item. Reuse chunked writes within the transaction. Audit actor/state/hash, never log image bytes or signature content.

Template selection accepts an active tenant-owned `InspectionTemplate` code `ANNAHME_CHECK`, latest version explicitly chosen in the UI. No template is required if none is configured. AUT-563 defines `GET /api/workshop/check-in-templates` returning `{data,meta}` and a tenant-admin create/version/deactivate surface in Settings, backed by the existing template models; owner/admin manage, advisors select only. Never mutate an in-use template version, never attach mechanic task checklists to a check-in. Mechanic inspections remain unchanged.

Existing mechanic/finding media queries must explicitly exclude `CHECK_IN` and `CHECK_IN_SIGNATURE`, preserving their existing general/finding semantics; do not classify legacy media as check-in. Add advisor media URL access under `GET B/media/:mediaId/url`, same role/site guards, signed lifetime <=5 minutes. Proposed check-in routes do not alter public estimate approval endpoints.

OpenAPI and frontend generated types change in AUT-555/563 and other route-owning PRs: regenerate/commit `apps/core-api/openapi/openapi.json` and `apps/core-web/src/api/generated/openapi.ts`. This docs-only PR changes neither contract artifact.

## Completion, image processing and immutable evidence

AUT-554 uses installed `sharp`: inspect actual decoded format and pixel count, accept <=10 MiB input and <=40 megapixels; apply orientation before removing metadata, resize longest edge to <=2048 px without upscaling, produce JPEG quality 85 and thumbnail <=320 px. Strip EXIF/GPS/XMP/IPTC; calculate SHA-256 over stored transformed bytes. Signature PNG <=1 MiB and <=2048x1024, flatten neither into a lossy photo nor retain stroke dynamics. Reject corrupt/decompression-bomb input, discard source bytes after processing, never expose originals through a signed URL. Stage uploads in a private scoped prefix; only READY sanitised objects become referenceable. Existing upload behaviour is unchanged unless the caller opts into this new processing contract.

Canonical evidence uses UTF-8 JSON, recursively sorted object keys, fixed schema version, integers for km/fuel, explicit nulls, UTC ISO timestamps, and arrays in defined order (markers/photos by id, checklist by frozen sort order then id, warning lights lexically). Hash with SHA-256. Freeze the serialized bytes in `snapshot_json` or a companion canonical text field so verification never depends on future serializer defaults. Include image byte digests rather than expiring URLs. No self-referential PDF digest inside this content digest.

Complete only after all client queue items are acknowledged, every referenced object is READY and required checklist answers/name/signature/checkbox exist. Check pending server uploads too. Completion freezes snapshot, source fields, media links/bytes and checklist values in one transaction; retention metadata and first PDF publication are separately guarded. All generic update/delete/cleanup routes must respect this freeze. A draft cannot complete if its parent was concurrently closed/invoiced or site disabled. Reject, preserve draft and ask advisor to resolve order status.

## PDF integration

AUT-561 extends `workshop/workshop-pdf.*` and existing `workshop-order` Cloud Tasks path (ADR-0007). Render condition, zone labels/markers, photo thumbnails, belongings, keys, warning lights, checklist, signer/name/time and acknowledgement; use frozen snapshot data, not current order/checklist/media captions. Existing order PDFs without completed check-in keep existing output. Draft output, if shown, is explicitly unsigned and not an evidence artifact.

After completion enqueue a render using a frozen **whole workshop-order PDF input snapshot**, including branding/assets and check-in evidence, under the existing pipeline kind. Persist that render input with the check-in snapshot/evidence metadata. The first final rendered PDF is stored at a write-once check-in-specific key, then its exact stored bytes are hashed and key/hash/time published by compare-and-set only while null. Worker retry reuses/verifies the same object; never overwrites it. Failure leaves hash null and UI shows retryable PDF error, not fabricated success. The PDF hash is not a signature over future order changes.

Later ordinary order-PDF regenerations can show the frozen check-in section with current task lines, but cannot change this first archived evidence PDF or its hash. Completion must invalidate/bypass the old order cache; do not rely on `WorkshopOrder.updatedAt` changing (no new columns there). Use check-in completion/hash in the cache decision or explicit cache invalidation in the existing service. Restrict all new read/download/worker entry points to tenant + order site; current tenant-only PDF lookup is not a sufficient guard for exposing new check-in evidence. Worker scope is resolved from the authorised order/site, not a user's current switcher. ADR-0024 invoice branding writer/archive flags are not check-in prerequisites; reuse read-only brand inputs, not invoice-only archive semantics. No new PDF kind or ADR amendment needed for this section.

## Tablet UX and component design

| Screen | Content and actions |
| --- | --- |
| 1: Vehicle & belongings | Existing order/customer/vehicle identity (read-only), mileage, fuel slider with numeric alternative, tyre season, items, keys, warning lights and optional reception checklist. |
| 2: Condition | Touch vehicle sketch plus accessible zone list, damage type/note, camera/file capture, thumbnails and explicit pending/retry state. |
| 3: Review & acknowledge | Full record including images/checklist, typed customer name, drawn signature with clear/reset, unchecked acknowledgement, online Complete at top right. Show frozen record and PDF pending/ready/error after completion in this screen. |

Proposed components under `apps/core-web/src/features/workshop/check-in/`: `WorkshopCheckInFlow`, `CheckInCondition`, `CheckInReview`, `CheckInSignature`, and narrow offline store/queue; route entry from order details and successful registration intake. Reuse shadcn controls, shared `StatusBadge`, shared `generateId()`, TanStack Query with one `workshopCheckInKeys` factory. Use generated DTO types. Header `text-2xl font-semibold tracking-tight`, subtitle `text-slate-500`, context left, actions right, no second PageContainer. Buttons >=44px, keyboard zone selection, meaningful camera labels, scroll-safe signature canvas, portrait/landscape tablet layout. No new list page, so list-only DataTable rules do not apply.

Complex form autosave is 750 ms with persistent Saving/Saved locally/Saved/Error state. Locally saved is never presented as server saved. Flush pending saves before navigation/review/completion; completion waits for latest server revision and review digest. New entity realtime invalidation maps `WORKSHOP_CHECK_IN` in the Prisma extension and `apps/core-web/src/features/realtime/dashboard-entity-map.ts`; also invalidate order PDF/status on completion. Remote changes mark a dirty local draft conflicted; do not replace user input silently.

### Sketch contract

AUT-559 supplies a repository-authored generic top-down SVG (front at top, left/right from driver's perspective), distributed under the repository's licence with provenance recorded next to the asset; no OEM diagram, logo, downloaded unlicensed silhouette or external URL. UI and PDF use the same `sketch_version:1` and zone map. Stable IDs: `FRONT_BUMPER`, `BONNET`, `WINDSCREEN`, `ROOF`, `REAR_WINDOW`, `BOOT`, `REAR_BUMPER`, `LEFT_FRONT_WING`, `LEFT_FRONT_DOOR`, `LEFT_REAR_DOOR`, `LEFT_REAR_WING`, `RIGHT_FRONT_WING`, `RIGHT_FRONT_DOOR`, `RIGHT_REAR_DOOR`, `RIGHT_REAR_WING`, `LEFT_FRONT_WHEEL`, `LEFT_REAR_WHEEL`, `RIGHT_FRONT_WHEEL`, `RIGHT_REAR_WHEEL`, `OTHER`. Zone IDs are persisted API values, translated labels are presentation. Markers need no pixel coordinates; multiple markers per zone allowed. Unknown IDs reject, future zone changes require a new sketch/schema version. Persist version in condition snapshot and use it in PDF.

## Offline policy

AUT-558 adds IndexedDB only for an already loaded, authenticated order. No cold offline login, offline order creation, signing/completion, service worker or background sync guarantee. Signature is online-only ephemeral input; interrupted signing restarts after reconnect. Check-in draft/photos survive reload while origin storage survives; browser eviction/private mode can still lose data and UI must say so.

- Store under authenticated `user_id/tenant_id/site_id/order_id/check_in_id`, with server base revision, one stable client check-in id and per-photo upload id, last saved time and queued payload bytes. Never persist bearer tokens, signed URLs or signature bytes offline. Cached identity is minimal and hidden behind current session checks.
- Quota: <=20 queued photos, <=10 MiB per original, <=100 MiB total across this user's queued drafts, <=50 MiB per order. Check `navigator.storage.estimate()` plus catch transaction/QuotaExceeded errors; reserve before replacing old blobs, do not evict an unsynced photo. On limit stop capture, retain the previous draft and show upload/delete instructions. No silent downgrade to volatile memory marked Saved.
- FIFO upload per check-in, two retries with exponential delays 1s/4s then explicit Retry; retry reconnects with same IDs, not new uploads. Refresh authorisation/site first, create/resume draft, flush revisioned fields, then media and marker links; update base revision after every acknowledgement. Network uncertainty retries identical payload before editing it. 401/403 pauses queue, never switches tenant automatically; site changes pause and hide draft until that site is reauthorised.
- 409 stops replay and shows local/server differences with explicit Keep server or Reapply local onto current revision, never last-write-wins. If completed remotely, show immutable server record and offer discard local draft; no overwrite. Duplicate check-in order/id conflict rebinds only after advisor review.
- Local drafts expire after 24h inactivity with visible expiry warning; cleanup must not silently erase unsynced work while open. Logout/account/tenant change clears local sensitive bytes after warning of unsynced loss and explicit discard or cancel switch. Server completed acknowledgements remove synced local blobs. Shared-tablet use must not reveal prior user's drafts.

## Privacy, retention and legal review

This signature is a **simple electronic signature for evidence only, not QES**, not an estimate/repair approval, waiver or certified identity proof. [eIDAS Article 25](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A02014R0910-20240520) distinguishes evidential effect from qualified-signature equivalence to handwriting. Evidence conventions align with AUT-353/ADR-0025 (exact content, actor/time/name, device/IP evidence, document hash) without reusing its customer-approval meaning or changing its separate release gates.

Draft German acknowledgement v1, **lawyer review requested**: “Ich bestätige, dass die oben dokumentierten Angaben zum Fahrzeugzustand und zu den übergebenen Gegenständen gemeinsam aufgenommen wurden. Diese Bestätigung ist keine Freigabe von Reparaturen oder eines Kostenvoranschlags.” Display immediately above unchecked acknowledgement and signature controls; store exact accepted wording. No marketing/privacy blanket consent, liability release, or implication that the drawer is the owner. Advisor verifies the person's stated name; record customer/representative as display evidence, not verified identity.

Photos may contain plates, VINs and bystanders. UI instructs advisor to avoid faces/documents/unrelated plates and allows retake before signing. EXIF removal alone is not anonymisation. Photos/signatures remain private, with scoped signed URLs, no public gallery, marketing/OEM reuse, analytics payloads or photo content in logs. Purpose and lawful-basis notice accompanies capture. [GDPR Articles 5, 6 and 17](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/) require purpose/storage limitation and a basis for retention; legal-claims exceptions do not justify keeping every image indefinitely.

Engineering retention defaults pending counsel correction: unsubmitted private uploads 24h; abandoned server drafts 7 days after last change; completed evidence until 31 December of completion year +3; linked invoiced order extends to 31 December of document year +7, never shortens; legal hold suspends scheduled erasure. IP/device hashes purge after 3 years, with a separate evidence-metadata retention record so purging them does not rewrite canonical signed content (the immutable snapshot excludes those hashes). Draft/snapshot/PDF/photo bytes share completed retention; no earlier bucket TTL. Expiry job removes bytes and records an auditable evidence-unavailable tombstone, then deletes personal evidence rows when policy permits. Erasure requests go through restricted legal-hold/claims review and authorised purge, not a generic PATCH/delete. Immutability prevents ordinary edits, not lawful erasure.

Legal follow-up owner: product owner with Austrian counsel; review wording, representative authority, lawful basis/photo notice, 3/7-year policy, HMAC evidence proportionality, erasure/holds and backup expiry. Referenced AUT-353 memos `/workspace/legal/02-aut-353-354-estimates-kostenvoranschlag.md` and memo set are **not available in this Windows workspace**, so their bytes were not reviewed. AUT-385's no-external-gate rule remains in force; this note does not claim legal approval.

## Implementation split and dependencies

Existing tickets were verified through Linear CLI; do not create duplicates. Sizes are estimates, not commitments.

| Ticket | Size | Deliverable / sequencing |
| --- | --- | --- |
| [AUT-554](https://linear.app/auto-core-platform/issue/AUT-554) | M | Sanitising image pipeline and byte fixtures, before photo publication. |
| [AUT-555](https://linear.app/auto-core-platform/issue/AUT-555) | M | Expand-only aggregate/media discriminator, scoped draft/media API, restore/deletion contract; after this spec. |
| [AUT-556](https://linear.app/auto-core-platform/issue/AUT-556) | M | Completion locks, canonical hash, immutable paths and idempotent retry; after 555. |
| [AUT-557](https://linear.app/auto-core-platform/issue/AUT-557) | M | Three-screen online tablet UI; after 554/555, completion integrates 556/560. |
| [AUT-558](https://linear.app/auto-core-platform/issue/AUT-558) | L | IndexedDB queue, quota and conflict handling; after 557. |
| [AUT-559](https://linear.app/auto-core-platform/issue/AUT-559) | M | Original SVG, zone contract, accessible markers; after 555/557. |
| [AUT-560](https://linear.app/auto-core-platform/issue/AUT-560) | M | Online drawn signature and review evidence; after 556/557. |
| [AUT-561](https://linear.app/auto-core-platform/issue/AUT-561) | M | Frozen PDF input, archived bytes/hash, cache invalidation and scoped downloads; after 556/560, integrates 559/563. |
| [AUT-562](https://linear.app/auto-core-platform/issue/AUT-562) | S | Race-safe orphan cleanup; after 554/555, honours 556 immutability. |
| [AUT-563](https://linear.app/auto-core-platform/issue/AUT-563) | M | Tenant reception template/version management and order checklist; after 555, completes immutability integration before epic release. |
| [AUT-564](https://linear.app/auto-core-platform/issue/AUT-564) | S | Existing registration-intake returned order opens same check-in; after 557 and AUT-537. |

No dependency cycle: completion/hash core accepts an absent checklist and freezes any present one; signature/PDF/optional checklist integrations extend it in later tickets. Epic end-to-end release requires all integrations, not merely the first CRUD ticket.

## Testing plan and acceptance criteria

These are future implementation requirements. No local tests were run for this documentation PR; GitHub CI is its validation gate.

- Backend E2E `apps/core-api/test/workshop-check-in.e2e-spec.ts`: tenant/site/role denial on every route and nested media/checklist/PDF; foreign linked IDs; disabled site; completed parent; unique order and duplicate create/upload retries with divergent payloads rejected.
- Concurrency tests: simultaneous autosave/complete/upload/delete/checklist mutation, stale review digest, order retarget/status/site changes, duplicate completion after response loss, no modification via generic mechanic/media/inspection routes after completion.
- Image fixtures: rotated EXIF/GPS/XMP image, malformed bytes/spoofed MIME, pixel bomb, exact byte cap, deterministic transformed hash, thumbnail, signature PNG and absence of original metadata. Finding media queries never include check-in media.
- Hash tests: property order stable, marker/photo order stable, changed condition/checklist/photo/signature/name/wording changes digest; server times added only at completion; HMAC metadata purge leaves content verification intact.
- Checklist tests: PASS_FAIL/NUMERIC/TEXT required validation, tenant/version selection, immutable label/type snapshots, null-task order inspection isolation, mechanic task inspections unchanged.
- PDF CI rendering/golden test: no-check-in output unchanged; completed section, photos/sketch/checklist/signature from frozen input; mutations to customer/order/templates/branding after completion cannot alter archived bytes; failed/retried render/upload never fabricates or overwrites PDF hash; cache cannot serve pre-completion PDF as evidence.
- Frontend component/Playwright CI: three-screen flow at tablet portrait/landscape, keyboard zone/camera/file alternatives, 750ms autosave/flush indicator, signature reset on edit, online-only completion, PDF retry visibility.
- Offline browser tests: disconnect/reload/reconnect, uncertain upload retry, queue limits/quota errors, concurrent browser edits, 401/403/site switch, remote completion, expiry/logout/discard behaviour; no silent overwrite, duplicate rows or cross-user local data.
- Restore/purge tests: FK cycle export/restore, image/PDF byte verification, tenant/object isolation, held evidence, 24h orphan and 7-day draft expiry races; cleanup acquires check-in lock and rechecks status/reference/age before delete, never deletes a referenced completed object or another tenant's upload.
- CI acceptance: OpenAPI and generated frontend types committed with implementing route changes; fresh unseeded serial backend E2E, tenant guard/lint/build/unit/frontend suites in owning PRs. No claimed production-device, live-storage, legal, or runtime verification from this spec alone.

## References and tracking

- Epic [AUT-552](https://linear.app/auto-core-platform/issue/AUT-552), spec [AUT-385](https://linear.app/auto-core-platform/issue/AUT-385); scope limited to this spec. Implementation children already Backlog except AUT-554 Todo at inspection time.
- [Customer communication and approvals](customer-communication-and-approvals.md) and [ADR-0025](../../01-ADR/2026-10-02-customer-communication-and-approvals.md).
- [ADR-0007 async PDF](../../01-ADR/2026-04-12-async-pdf-pipeline.md), [ADR-0024 branding](../../01-ADR/2026-09-27-legal-entity-document-branding.md), ADR-0022 operational site rules in repository AGENTS.md.
- [Registration intake spec](../Vehicles/registration-document-intake.md); existing `docs/deletion-policy.md` and `tools/tenant-restore/`.
