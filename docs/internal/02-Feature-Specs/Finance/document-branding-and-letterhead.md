---
title: "Document Brand Profile and Letterhead Extraction"
date: "2026-09-27"
module: finance
status: approved
linear-project: "https://linear.app/auto-core-platform/project/legalentity-document-branding-and-letterhead-28dc131cc98c"
linear-milestone: "0 — Spec & ADR"
tags: [feature-spec, finance, legal-entity, pdf]
---

# Document Brand Profile and Letterhead Extraction

## Summary

An OWNER/ADMIN configures a legal entity's invoice appearance manually or uploads a PDF/PNG letterhead, reviews extracted suggestions in a sample invoice preview, and confirms the result. Newly committed invoices freeze that confirmed appearance alongside their seller and financial facts. Profile changes and extraction failures cannot change an existing invoice or its archived PDF.

**Approved by Dejan Dosenovic (Product Owner) on 2026-09-27.** This spec implements the decisions in [ADR-0024](../../01-ADR/2026-09-27-legal-entity-document-branding.md), accepted on the same date. Numeric limits and lifecycle choices below are the approved product baseline. Provider activation and rendered-invoice acceptance gates remain open as recorded below. No runtime implementation or provider activation is part of AUT-318.

## User Stories

- As an OWNER/ADMIN, I can configure each legal entity's logo, colors and decorative text so its invoices reflect its identity.
- As an OWNER/ADMIN, I can import an existing letterhead, inspect suggestions, edit them and confirm or discard them.
- As an OWNER/ADMIN, I can finish setup manually when extraction is unavailable or inaccurate.
- As an authorized invoice reader, I can download the original issued PDF after branding changes.

## Scope and Existing Integration Points

Slice 1 covers new sales, workshop and vehicle-sale invoices through their existing commitment paths. It provides one preset, `standard-v1`, manual editing, sample HTML preview, assisted extraction and reset to ACP defaults. `classic` in the initial Linear brief is replaced by the accepted ADR's preset identifier.

Job cards, offers, credit-note branding, franchise packs, extra presets/fonts, arbitrary HTML/CSS, full-page letterhead backgrounds, structured e-invoice packs and styling of vehicle/parts `Brand` records are excluded. Existing country/tax-profile activation gates remain in force.

| Inspected source | Required integration |
|---|---|
| `src/site/legal-entity.service.ts`, `src/site/site.authorization.ts` | Reuse tenant administration and active membership checks; legal entity is the settings owner |
| `src/invoices/invoice-snapshot-commit.service.ts` | Freeze branding at commitment across all three invoice origins |
| `src/invoices/invoice-snapshot-v2.ts`, validation and render adapter | Add a versioned branding extension; preserve it when adapting to renderer input |
| `src/invoices/invoice-pdf.renderer.ts`, `invoice-pdf.layout.ts` | Apply bounded chrome while retaining ACP body and legal blocks |
| `src/common/pdf/pdf-storage.ts`, `pdf-render-upload.ts` | Add immutable publication; current `file.save` does not use a create-only precondition |
| `apps/core-web/src/components/settings/LegalEntitiesSettingsTab.tsx` | Place Document branding inside the selected legal entity's settings |

Backend paths above are relative to `apps/core-api`. These are future implementation targets, not claims that branding already exists.

## Configuration Contract

### ThemeV1

All fields are required in a complete draft; optional values use explicit null. Reject unknown properties at every nesting level. Store canonical values, not CSS fragments.

| Field | Type / validation | ACP default |
|---|---|---|
| `schemaVersion` | Integer literal `1` | `1` |
| `presetId` | Literal `standard-v1` | `standard-v1` |
| `logoAssetId` | UUID or null; READY PNG owned by this tenant and legal entity | null |
| `primaryColor` | `#[0-9A-F]{6}`; normalize hex to uppercase | `#111827` |
| `secondaryColor` | Same hex rule | `#E5E7EB` |
| `fontId` | Literal `acp-sans-v1` | `acp-sans-v1` |
| `headerBand`, `footerBand` | `none`, `primary` or `secondary` | `none` |
| `headerText` | Plain text, max 120 Unicode code points, max two explicit lines | empty string |
| `footerText` | Plain text, max 120 Unicode code points, one explicit line | empty string |

Normalize text to NFC and line endings to LF. Reject all Unicode control (`Cc`) and format (`Cf`) characters, except at most one `U+000A` newline in `headerText`; `footerText` permits no newline. In particular, reject bidi overrides and isolates (`U+202A`–`U+202E`, `U+2066`–`U+2069`). Also reject markup delimiters `<`/`>` and `${...}` / `{{...}}` interpolation syntax. Escape all text when rendering, including rejected-input diagnostic previews. Do not infer seller addresses, tax identifiers or bank details from decorative text.

`acp-sans-v1` means one bundled Noto Sans font build with regular/bold weights, a recorded checksum and license. Package the same files with preview assets and the PDF worker; no remote font fetch or operating-system fallback for new branded renders. This does not change historical renderer versions.

### Preset and protected content

Use A4 portrait, 16 mm left/right margins, a 32 mm header reservation and a 28 mm footer reservation. Invoice body flows between y=48 mm and y=253 mm. Logo fits a 45 × 18 mm box without distortion. Bands are 3 mm high; their placement cannot be supplied by the tenant. Header/footer decorative text uses 9 pt type in bounded boxes; it may wrap to two header lines or one footer line and ellipsize only decorative overflow. Show the exact same clipping and an overflow warning in preview. Never clip legal blocks, invoice lines, totals or pagination.

Primary color may be used for heading text only with at least 4.5:1 contrast on white; otherwise reject with `BRAND_COLOR_CONTRAST`. Secondary color is decorative only. Band text, if used by the preset, selects black or white with at least 4.5:1 contrast; the tenant cannot supply that foreground. Keep financial tables and legal body text in ACP's existing legible colors. Screen-reader labels and status messages must not rely on color alone.

Seller/customer blocks, tax text, payment facts, document identifiers, totals and margin-scheme handling stay ACP-owned and snapshot-derived. Long legal content flows in the body across pages. A logo never replaces the legal seller name. `standard-v1` is deployed together with an explicit renderer version `invoice-brand-v1`; subsequent geometry changes get a new version, with old versions retained for historical recovery.

## Database Impact

### New Tables / Columns

All IDs are UUIDs. Each table has `tenant_id`, `createdAt`, `updatedAt` and a tenant-safe unique `(tenant_id, id)` key. Relations to `LegalEntity` use `(tenant_id, legal_entity_id)`. No branding table has `site_id`: the configuration is shared across the legal entity's sites, while invoice access remains site-scoped.

| Model / SQL table | Required fields and constraints |
|---|---|
| `DocumentBrandProfile` / `document_brand_profiles` | `legal_entity_id`; unique `(tenant_id, legal_entity_id)`; `revision` integer starting at 1; `active_revision` integer starting at 0; nullable `active_theme` JSON; nullable `draft_theme` JSON; nullable `confirmed_at`, `confirmed_by_user_id`; nullable `draft_extraction_id`; nullable `last_confirmation_key`, `last_confirmation_hash`. Both themes validate as ThemeV1. Null active theme means ACP defaults. |
| `DocumentBrandAsset` / `document_brand_assets` | `legal_entity_id`; `purpose` SOURCE or LOGO; `state` QUARANTINED, READY, REJECTED, DELETING or DELETED; immutable server-created `bucket`, `object_key`, `object_generation`, SHA-256, byte length, detected MIME type; nullable pixel width/height, `source_asset_id`, `expires_at`, `failure_code`. Unique object identity. Original names are bounded display metadata, never object keys. |
| `DocumentBrandExtraction` / `document_brand_extractions` | `legal_entity_id`, `source_asset_id`, `requested_by_user_id`; `state` QUEUED, RUNNING, SUCCEEDED, FAILED or DISCARDED; `base_revision`; nullable `proposal_theme`, bounded `warnings`, `failure_code`; server-owned provider/model/prompt-version identifiers; `attempt_count`, nullable `lease_until`, `completed_at`; idempotency key and request hash unique per tenant/entity. |
| `InvoiceBrandAssetReference` / `invoice_brand_asset_references` | `invoice_id`, `legal_entity_id`, `asset_id`; unique `(tenant_id, invoice_id, asset_id)`; composite FKs ensure the invoice and asset belong to the same tenant and legal entity. Restrict deletion. Created in the invoice commitment transaction. |

Asset relations also include legal-entity ownership in composite keys so a same-tenant but different-entity asset cannot be attached. Relational draft/active logo references must mirror theme JSON `logoAssetId`, with checks in the same transaction; use nullable `draft_logo_asset_id` and `active_logo_asset_id` FKs on the profile and nullable `proposal_logo_asset_id` on extraction. The JSON references alone cannot enforce retention. Extraction `source_asset_id` becomes nullable only after terminal-job payload expiry; creating a job always requires a source. Nullable actor relations use the project's audit identity convention and never cascade-delete history when a user is removed.

Quarantined assets have a separate server-owned quarantine locator. Validated content is published to a fresh immutable object before READY; final generation/hash/dimensions are nullable until that transition and immutable afterwards. Discard the quarantine copy only after recording the READY object, or let its 24-hour cleanup remove it. A source asset's normalized raster is temporary processing data; only a chosen derived logo is retained as a separate LOGO asset. Recovery handles validation crashes and object-upload/DB-update gaps without reusing mutable object keys.

### Modified Tables and Migration

| Existing model | Change | Migration |
|---|---|---|
| `LegalEntity` | Profile/assets/extractions relations and deletion guards | Additive relations and foreign keys |
| `Invoice` | Optional `branding` member in snapshot JSON; asset-reference relation; nullable archive object-generation and SHA-256 metadata | Additive nullable metadata and reference FKs; composite unique `(tenant_id, legal_entity_id, id)` for entity-safe references; existing JSON untouched |

Index extraction state/lease for recovery and asset state/expiry for cleanup. Add tenant and entity scope to every lookup, include and mutation; nested invoices remain site-authorized. Fetch referenced assets in one bounded query rather than a query per invoice line. Do not seed profiles for every entity: absence resolves to the versioned default at new invoice commitment.

### Deletion Policy Impact

The approved rules are also recorded in [the deletion policy](../../../deletion-policy.md). Reset means a new confirmed default revision; it does not delete the profile or invoices. No public hard-delete profile endpoint exists. Assets referenced by an active/draft logo, active extraction or committed invoice are ineligible for cleanup. Used asset reference rows and invoice archives are retained without an application TTL.

Unreferenced original source files and extraction proposals expire 30 days after creation; source expiry is not extended by retaining a proposal's derived logo. Before source cleanup, make related jobs terminal and remove their source relation only as part of cleanup after the retention period. Derived/direct logos that have no protecting reference receive a 7-day grace period from when their last reference is removed. Quarantined/rejected uploads expire after 24 hours. Never apply these short bucket lifecycle rules to retained logo/archive objects.

Cleanup locks the legal entity and asset rows, rechecks all reference classes, marks DELETING, then deletes the exact GCS generation outside the DB transaction. Confirm/commit rejects DELETING assets. Retry failed object deletion; mark DELETED only after successful deletion or verified absence. Keep a metadata tombstone without original filename/payload for audit. A legal entity can be hard-deleted only under its existing rules and when branding retention does not protect it; clean unused branding configuration may be removed transactionally with an unused entity. Tenant purge remains outside this feature.

## State Machines and Concurrency

### Draft, confirmation and reset

GET of a missing profile returns `revision: 0`, `activeRevision: 0`, resolved defaults and no draft; it performs no write. First draft save uses `expectedRevision: 0`. Profile writes lock the legal entity first and use a conditional revision update. Every successful draft edit, discard, confirm or reset increments `revision`; only confirm/reset increments `active_revision`.

Auto-save writes the **draft only**. Confirmation copies the saved draft to active_theme, clears the draft and its extraction reference, records actor/time and increments both counters. Reset similarly confirms defaults and clears any draft after an explicit UI confirmation. Editing or discarding a draft never changes active_theme. Discard is idempotent when no draft exists and the expected revision matches.

Confirm/reset require `expectedRevision` and an `Idempotency-Key` UUID. Store the last successful key, request hash and result revision. Immediate identical retries return the recorded result even after the draft was cleared; a reused key with changed content or a stale revision returns 409. If another confirmation replaced the remembered key, the old request's stale revision still prevents replay. This bounded idempotency record is sufficient for settings; it is not a new invoice numbering mechanism.

Extraction success writes a proposal, never a profile. Applying a proposal to the draft is an explicit `PUT draft` with `extractionId` and full ThemeV1. Reject if the job is not SUCCEEDED, expired, belongs to another entity, or its `base_revision` no longer matches the current profile revision. The user can re-extract from a fresh revision or manually re-enter desired values after conflict; no force-overwrite path. Later manual edits preserve provenance without granting the model any authority to confirm.

### Extraction and uploads

API authenticates and streams a bounded upload into private quarantine. A separate authenticated Cloud Tasks job on the existing worker deployment validates/normalizes it and sets READY or REJECTED. This is a new task handler with its own signed payload type, not a PDF task kind pretending to render an invoice. Reuse worker IAM/OIDC and HMAC/tenant binding; do not add a second render stack. Persist validation attempt count/lease on the asset; a recovery sweep reschedules unclaimed QUARANTINED assets, with three attempts maximum and terminal rejection before the 24-hour quarantine expiry. Worker publication must use a conditional state update so duplicate deliveries cannot change a READY object's identity.

Extraction creation returns 202 and persists a QUEUED job. The worker atomically claims QUEUED → RUNNING with a lease; it revalidates requester membership/role, active entity, source ownership/state and expiry before processing. Lost authorization fails the job without exposing content. Success stores a validated complete ThemeV1 proposal and warnings; failure stores a bounded reason. Up to three attempts are allowed for transient provider/queue failures, with a 120-second lease and 60-second attempt limit. A recovery sweep requeues expired leases and unpublished QUEUED jobs; exhausted attempts become FAILED. DISCARDED is terminal and blocks a late worker from publishing results.

`POST extractions` requires an idempotency key; identical retries return the existing job and changed input under the same key returns 409. User retry after failure creates a new job/key. At most one QUEUED/RUNNING extraction per entity, enforced by a partial unique constraint. Discarding a SUCCEEDED or unfinished job releases the proposal for cleanup; it does not revoke an already confirmed logo or historical snapshot.

## API Contract Changes

All routes below start with `/api/legal-entities/:legalEntityId/document-branding`. Request/response DTOs use camelCase. Server obtains tenant scope from `TenantContextService`; clients cannot choose a tenant, bucket, key, generation, renderer version or provider credential. Common errors use `{ code, message, fieldErrors? }` inside the established Nest error envelope.

### New Endpoints

| Method / suffix | Request | Response | Authorization |
|---|---|---|---|
| GET `/` | None | 200 ProfileResponse | Active tenant OWNER/ADMIN; entity may be inactive for read |
| PUT `/draft` | `expectedRevision`, full `theme`, optional `extractionId` | 200 ProfileResponse | Active tenant OWNER/ADMIN and active entity |
| DELETE `/draft` | `expectedRevision` query | 200 ProfileResponse | Same mutation permission |
| POST `/confirm` | `expectedRevision`; Idempotency-Key | 200 ProfileResponse | Same; non-null saved draft required |
| POST `/reset` | `expectedRevision`; Idempotency-Key | 200 ProfileResponse | Same; explicit default confirmation |
| POST `/assets` | Multipart `file`, purpose SOURCE or LOGO | 202 AssetResponse (QUARANTINED) | Same mutation permission |
| GET `/assets/:assetId` | None | 200 AssetResponse | Tenant OWNER/ADMIN, matching entity |
| GET `/assets/:assetId/content` | None | Authorized stream of READY normalized PNG/source download | Same; sources served as attachment, never inline PDF |
| POST `/extractions` | `sourceAssetId`, `expectedRevision`; Idempotency-Key | 202 ExtractionResponse | Mutation permission; READY SOURCE required |
| GET `/extractions/:extractionId` | None | 200 ExtractionResponse | Tenant OWNER/ADMIN, matching entity |
| POST `/extractions/:extractionId/discard` | None | 200 ExtractionResponse | Mutation permission; terminal discard idempotent |
| POST `/preview` | Full `theme`, sample `AT_STANDARD`, `DE_STANDARD` or enabled `MARGIN_FULL`; no invoice ID | 200 `{ html, warnings, themeHash }` | Tenant OWNER/ADMIN, matching entity |

`ProfileResponse` contains `revision`, `activeRevision`, `activeTheme` (resolved defaults when unset), nullable `draftTheme`, `confirmedAt`, `confirmedByUserId` and `capabilities.extractionAvailable`. `AssetResponse` exposes id, purpose, state, detected MIME, bytes, dimensions and safe failure code; never storage locators. `ExtractionResponse` exposes id, state, proposal (only after success), warnings, base revision, timestamps and safe failure code; never raw model messages. No list route is needed; any later list uses `{ data, meta }` and standard pagination.

Settings sample preview contains synthetic invoice/customer data and uses the selected legal entity only for ownership checks. It grants no access to that entity's operational invoices. Existing real invoice routes continue to apply active site or approved authorized-site scope, including download. OWNER/ADMIN settings access is not a bypass for invoice authorization.

Return 401 unauthenticated, 403 for insufficient role/active membership, and 404 for foreign/missing entity, asset or job. Return 409 `BRAND_REVISION_CONFLICT`, `BRAND_EXTRACTION_BUSY` or `BRAND_IDEMPOTENCY_CONFLICT`; 413 `BRAND_UPLOAD_TOO_LARGE`; 415 `BRAND_FILE_TYPE_UNSUPPORTED`; 422 for inactive entity, invalid tokens, non-READY asset, no saved draft or expired proposal; 429 for quotas with Retry-After. When provider activation is disabled, extraction creation returns 503 `BRAND_EXTRACTION_UNAVAILABLE`; manual settings and preview remain usable.

### Upload and processing limits

| Resource | Approved limit / handling |
|---|---|
| SOURCE | PDF or PNG, detected bytes must match type, maximum 10 MiB |
| LOGO | PNG only, maximum 2 MiB; server decodes and re-encodes to strip metadata |
| Source PDF | Maximum five pages, unencrypted; extract first page only and warn when further pages are ignored |
| Input image | Maximum 16 megapixels and 8,192 pixels per side; reject before full allocation |
| Raster supplied to extraction | First page at up to 150 DPI, downscale to max 2,048 pixels per side / 4 megapixels |
| Derived logo | Server crops a normalized raster; max 1,024 pixels per side and 2 MiB PNG; no model-supplied image URL |
| Validation/rasterization | Isolated process, 256 MiB memory limit, 15-second wall limit; reject embedded executable content, embedded files and PDF actions |
| Provider | One bounded request per attempt, 30-second deadline, maximum 8 KiB structured result; no tools or external fetching |
| API quota | 20 uploads and 10 extraction requests per legal entity per rolling hour; atomic server counters, 429 at limit |
| Preview | 30 requests per user/minute; POST `/preview` request body maximum 16 KiB (theme JSON and sample profile enum, with no file upload). HTML response body maximum 8 MiB, including an authorized READY logo embedded as a PNG data URI and any bundled preview font data. Reject an oversized response explicitly; never truncate the logo or chrome. |

Quarantine validation must fail closed; encrypted, malformed or unsafe files become REJECTED. Raw sources never reach `page.setContent` or the invoice renderer. Rasterization is input preprocessing, not a replacement PDF renderer. Select and pin the sandboxed rasterizer in the extraction implementation issue, with the resource/hostile-PDF acceptance cases below.

### Modified Endpoints / OpenAPI

Existing invoice request bodies and document status transitions do not change. Internal snapshot readers and PDF responses must preserve branding and immutable archive semantics. If snapshot/archive metadata is exposed by existing response DTOs, explicitly update that contract; do not silently leak storage keys or internal render fields.

- [ ] Implementation generates `apps/core-api/openapi/openapi.json` via `npm --prefix apps/core-api run openapi:generate`.
- [ ] Implementation generates `apps/core-web/src/api/generated/openapi.ts` via `npm --prefix apps/core-web run api:types:generate`.
- [ ] Commit both artifacts and pass contract drift checks. This documentation PR changes neither artifact.

## Extraction Provider Decision and Data Handling

**Provider ownership accepted by Dejan Dosenovic on 2026-09-27:** one ACP-managed provider behind a small extraction interface, with credentials in Google Secret Manager and no tenant BYOK/provider settings in Slice 1. The exact provider/model is an **extraction activation gate**, not an invitation to silently select one during deployment. Product/operations must approve model/version, region, data-processing terms, retention behavior and cost cap before enabling outbound extraction. No claim of zero retention or EU-only processing is made without evidence.

Send only the validated normalized first-page image and a fixed schema prompt. Do not send unrelated invoice/customer data, actor identities, credentials or storage URLs. Do not log the image, raw response or extracted personal text. Store validated proposal, bounded warning codes and model/prompt identifiers for 30 days. Provider failure leaves configuration unchanged. Manual setup ships independently; full AUT-318 Slice 1 acceptance still requires the assisted extraction path and its provider gate.

Model output may suggest colors, decorative text and a normalized crop rectangle `(x, y, width, height)` within `[0,1]`; a server cropper creates the logo asset. The model cannot choose asset IDs, template code, tenant scope or a provider. Unknown keys, invalid bounds and schema violations fail extraction. Unsupported fonts/layouts produce a warning and the supported preset/font. Low confidence produces editable suggestions or a failed job, never auto-confirmation; no numeric model confidence is treated as proof of correctness.

## Snapshot and PDF Contract

### Frozen fields

Keep financial snapshot `schema_version: 2` and introduce an additive `branding` member with independent `schema_version: 1`. All newly committed invoices after feature activation must include it, including ACP defaults. Historical V1/V2 snapshots without it retain their historical render path. New branded documents set `template_version: invoice-brand-v1`; the adapter must preserve both this version and branding. Recognizing the new template version without its required branding member is corruption, not a legacy fallback.

| Frozen member | Value |
|---|---|
| `schema_version` | `1` |
| `profile_id`, `profile_revision` | Nullable profile UUID and active revision; defaults use null/0 before any profile exists |
| `preset_id`, `renderer_version`, `font_id` | `standard-v1`, `invoice-brand-v1`, `acp-sans-v1` |
| `tokens` | Resolved colors, bands and text, including defaults; no live references |
| `logo` | Null, or asset ID, bucket, key, exact generation, SHA-256, MIME `image/png`, width/height |
| `resolved_at` | Same commitment timestamp used for invoice snapshot evidence |

Logo locators are server-only internal snapshot fields and are not sent in ordinary public DTOs. The worker validates asset-reference ownership and checks generation/hash before use. Font/renderer manifests are versioned release artifacts. No signed URL, mutable profile lookup, source file or raw extraction output participates in rendering.

### Atomic commitment and archive publication

Resolve source-owned legal entity inside the authorized tenant/site and lock the legal entity before site/finance/source/invoice/sequence locks, following ADR-0023. Confirm/reset/draft writes and asset cleanup take that same entity lock before child-row locks. This serializes first-profile creation, deletion and publication against commitment, including the missing-profile case. Acquire any multiple asset IDs in stable sorted order. Audit all three issuance call paths so a later helper does not acquire the entity lock after already locking a site.

Within the existing commitment transaction: validate active confirmed theme and READY logo metadata; freeze resolved fields; insert InvoiceBrandAssetReference; persist financial snapshot and perform the existing guarded status/number/stock operations. Never perform provider, GCS or browser calls while holding those locks. Stored READY validation plus retained immutable object identity supplies the asset evidence; a later external outage affects rendering, not the committed financial record.

Branded invoice rendering first checks the archived object. If present, return its original bytes after authorization. Otherwise render from frozen inputs and publish to a deterministic tenant/invoice/snapshot-specific key with GCS `ifGenerationMatch: 0`. A competing worker's precondition failure means read and verify the existing winning artifact's tenant/invoice/snapshot identity; do not overwrite or blindly adopt an unrelated object. Persist the winning generation/hash and object pointer conditionally. After a crash between upload and database update, retry discovers that same object and repairs only archive metadata. No new issuance or number is generated.

Bucket permissions/lifecycle must prohibit replacing or automatically deleting retained logo generations or archives. Missing generation, hash mismatch or unavailable historical renderer produces an explicit `BRAND_RENDER_INPUT_UNAVAILABLE` failure in the existing PDF error reporting; never swap in today's logo or defaults. Existing archived PDFs always take precedence over regeneration. Roll out readers/retention/create-only publication before the new writer; after activation, rollback disables new branded issuance if needed while keeping historical readers, assets and PDFs.

## UX Compliance

Inside Settings → Legal Entities → selected entity, add a Document branding section. Top-left contains context, title and status; top-right contains Upload letterhead, Confirm branding and Reset to default. Show the active appearance separately from “Draft — not yet used on invoices.”

- [ ] Header uses `text-2xl font-semibold tracking-tight`; subtitle uses `text-slate-500`.
- [ ] Multi-field draft edits auto-save after 750 ms with persistent Saving/Saved/Error indicator. Invalid local edits show field errors and do not replace a valid saved draft. Confirm is disabled while save is pending, invalid or conflicted.
- [ ] Upload/extract shows progress and bounded errors. “Use proposal” copies suggestions to the draft; “Discard” keeps the current appearance. Confirm requires an explicit click and a preview of the latest saved draft.
- [ ] Reset requires confirmation explaining that future invoices use ACP defaults. Previously issued documents are unaffected.
- [ ] A 409 preserves local edits and offers reload/review; it never retries with a newer revision automatically.
- [ ] Sample preview displays “Sample — not an invoice,” uses synthetic content and the shared server layout. Render in a sandboxed iframe with no scripts, forms, same-origin access or navigation permissions; CSP denies network except embedded data assets.
- [ ] Preview may show ACP-supported tax fixtures only; accountant review verifies all activated country/tax profiles in the existing legal-invoice scope.
- [ ] Statuses use shared StatusBadge mappings; controls use shadcn primitives and keyboard-accessible labels.

There is no new list page in Slice 1, so list search/sort/create/context-delete rules are not applicable. The editor is a multi-field draft form; `InlineEdit` save-on-blur is not used for it. Preview is presentation of synthetic data, not a new endpoint to view invoices across sites.

### Real-Time Sync

Use one `documentBrandingKeys` query-key factory under `src/api/document-branding.ts` for profile, asset and extraction queries. Invalidate on local mutations and refetch profile on window focus. Poll pending upload/extraction every two seconds while visible; stop when terminal, cap the visible wait at two minutes and offer refresh. Persisted jobs remain recoverable after navigation.

No dashboard broadcast is required for private settings/extraction in Slice 1, so do not register raw profile/proposal data with `SUPPORTED_ENTITY_TYPES` or the dashboard entity map. Optimistic concurrency detects other-admin edits. Existing invoice PDF completion notifications continue unchanged. If a later issue adds settings events, it must specify authorized recipients first.

## Component Design

| Component / module | Planned location | Responsibility |
|---|---|---|
| DocumentBrandingSettings | `apps/core-web/src/components/settings/document-branding/` | Active/draft state, permissions and confirmation actions |
| DocumentBrandThemeForm | Same directory | Typed token fields and debounced draft save |
| DocumentBrandPreview | Same directory | Isolated synthetic HTML preview and warnings |
| LetterheadImport | Same directory | Upload, extraction status, proposal apply/discard |
| DocumentBrandingModule | `apps/core-api/src/document-branding/` | DTOs, scoped profile/assets/jobs and token validation |
| Snapshot integration | Existing invoice snapshot commit/validation/adapter files | Freeze and carry the branding extension |
| Versioned renderer/storage | Existing invoice renderer and common PDF services | Chrome layout, immutable asset resolution and archive publication |

## Impact Analysis

| Dimension | Effect |
|---|---|
| Database | Four additive models, profile logo FKs, archive metadata; no historical snapshot backfill |
| State machines | Profile revisions, quarantined assets and leased extraction jobs; invoice states unchanged |
| Deletion | Retained logo references block cleanup; reset is a revision, not deletion |
| Real-time | Settings polling/local invalidation; existing PDF notifications reused |
| API | New OWNER/ADMIN settings routes; regenerated OpenAPI/frontend types at implementation |
| Inventory | No new stock mutations; existing invoice commitment effects remain atomic |
| Finance | Branding freezes at legal commitment; fiscal lock, seller and tax content remain authoritative |
| UX | Entity settings, draft autosave, explicit confirmation and synthetic preview |

## Testing Plan

Tests below are acceptance requirements for implementation, not tests run by this documentation task.

| Layer | Required cases and observable result |
|---|---|
| Unit | Defaults canonicalize; unknown properties, CSS payloads, invalid colors, contrast, overlong text and crop bounds reject; escaped output has no executable markup |
| Backend E2E | Missing profile → manual draft → confirm → invoice commitment → frozen default/custom snapshot and asset references; all sales/workshop/vehicle paths covered |
| Isolation | Two tenants and two legal entities; forged entity/asset/job IDs return 404; non-admin/inactive membership denied; settings admin cannot download another site's invoice |
| Extraction | Valid upload → mock provider → proposal → edit → confirm; low confidence, timeout, unavailable provider, malformed output, duplicate delivery, revoked membership and discarded-job late completion leave active profile intact |
| Upload/security | Spoofed MIME, encrypted PDF, embedded actions, too many pages, decompression bomb, extreme dimensions, path traversal and quotas; bounded rejection and no outbound URLs from source/model |
| Concurrency | Two admin saves conflict; confirm retries are idempotent; first profile vs invoice/default commit is serial; cleanup vs confirm/issue cannot lose an asset; entity deactivation vs writes respects locks |
| Archive | Delayed render after profile edit still uses frozen version; concurrent workers publish one object; crash after upload recovers pointer; repeat download bytes/hash identical; missing/corrupt asset fails visibly |
| Legacy | Existing V1/V2 with/without archived PDFs keep existing evidence rules; new render version missing branding errors; adapters never silently drop branding |
| Frontend | Autosave affects only draft; pending/error/conflict disables confirm; discard/reset work; keyboard use and tenant/entity switch cancel stale view updates; iframe cannot run script or navigate |
| Visual | Default/logo/bands, transparent/tall/wide logo, 120-character text, ten-page invoice, long seller/legal fields, AT/DE standard and enabled margin fixtures preserve all body/legal content and totals. See the [render fixture suite](../../../../apps/core-api/test/invoice-branding-render.e2e-spec.ts) and [Slice 1 release acceptance record](../../03-Runbooks/document-branding-slice-1-release-acceptance.md); CI evidence and human approval remain tracked there. |

Backend integration tests belong in `apps/core-api/test/document-branding.e2e-spec.ts` and the existing invoice-flow suites. Use isolated unseeded test DB/serial E2E conventions. Provider integration uses deterministic mocks; one approved provider fixture is checked in the gated extraction environment without committing customer documents. Visual sign-off records actual render artifacts, reviewer/date and fixture/version.

## Delivery Sequence and Review Gates

1. **AUT-318 spec review complete:** token/geometry/retention/authorization choices and ACP-managed provider ownership are approved. Resolve exact provider configuration before extraction activation.
2. **Profile and assets:** migrations, guards, draft/confirm/reset, quarantined storage, manual editor/preview and deletion rules. Include contract artifacts and tests.
3. **Invoice and archive integration:** reader support, commitment locks/snapshots/references, versioned renderer and create-only publication across all origins. Enable only after historical/concurrency fixtures pass.
4. **Assisted extraction:** provider approval, parser sandbox, queue recovery, quotas, mock/live fixtures and proposal UI. Keep manual flow available during failures.
5. **Release acceptance:** PO and accountant approve branded sample Rechnung fixtures; confirm deployment ordering, asset retention and monitoring. Job-card/offer/credit branding stays deferred.

Implementation issues follow these approved boundaries. Each runtime issue still requires its detailed implementation plan and the repository's normal TDD/review workflow; spec approval does not waive provider or visual release gates.

| Order | Linear issue | Prerequisite |
|---|---|---|
| 1 | [AUT-322 — Profile, assets and manual settings](https://linear.app/auto-core-platform/issue/AUT-322) | AUT-318 spec PR lands |
| 2 | [AUT-323 — Immutable invoice snapshots and PDF archives](https://linear.app/auto-core-platform/issue/AUT-323) | AUT-322 |
| 3 | [AUT-324 — ACP-managed extraction and confirmation](https://linear.app/auto-core-platform/issue/AUT-324) | AUT-323; provider gate before activation |
| 4 | [AUT-325 — Visual acceptance and release gates](https://linear.app/auto-core-platform/issue/AUT-325) | AUT-324 and all acceptance evidence |

The dependency chain determines delivery order. Existing project milestone labels place extraction in milestone 2 and invoice PDF in milestone 3; those labels do not override the approved invoice-before-extraction sequence.

## Open Questions / Approval Record

- [x] ADR accepted: Dejan Dosenovic, 2026-09-27; [PR #585](https://github.com/vandean25/auto-core-platform/pull/585) merged.
- [x] PO accepts this spec's limits, retention, draft/confirm behavior, preset geometry and administration scope — Dejan Dosenovic, 2026-09-27.
- [x] PO selects ACP-managed extraction — Dejan Dosenovic, 2026-09-27. Tenant provider settings are excluded.
- [ ] Before extraction activation, product/operations records exact provider/model/version, region, retention/data terms, cost cap and parser package/version with the implementation issue. Until then outbound extraction stays disabled.
- [ ] PO + accountant accept rendered branded fixtures before release. This spec is not accountant sign-off or proof of legal sufficiency.

## References

- [ADR-0024: LegalEntity Document Branding and Letterhead Extraction](../../01-ADR/2026-09-27-legal-entity-document-branding.md).
- [ADR-0004: Invoice Snapshotting](../../01-ADR/2026-04-12-invoice-snapshotting.md), [ADR-0007: Async PDF Pipeline](../../01-ADR/2026-04-12-async-pdf-pipeline.md).
- [ADR-0023: Legal Invoicing](../../01-ADR/2026-09-20-legal-invoicing-and-accounting-export.md), [ADR-0022: Site Scope](../../01-ADR/2026-08-31-site-operational-scope.md).
- [Legal invoicing and credit notes](legal-invoicing-and-credit-notes.md), [Deletion policy](../../../deletion-policy.md), [Deferred capabilities](../../.architecture/deferrals.md).

## Linear Tracking

| Field | Value |
|---|---|
| Project | [LegalEntity Document Branding & Letterhead](https://linear.app/auto-core-platform/project/legalentity-document-branding-and-letterhead-28dc131cc98c) |
| Milestone | 0 — Spec & ADR |
| Issue | [AUT-318](https://linear.app/auto-core-platform/issue/AUT-318/feature-spec-document-brand-profile-and-briefvorlage-theme) |
| Dependency | AUT-317 Done; ADR-0024 accepted by PO |
| Status | PO approved 2026-09-27; provider activation and rendered-fixture acceptance remain release gates |
