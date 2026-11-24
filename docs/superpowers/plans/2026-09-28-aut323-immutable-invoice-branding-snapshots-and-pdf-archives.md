# AUT-323 Immutable Invoice Branding Snapshots and PDF Archives Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to execute this plan task-by-task. Each task is independently testable. Steps use checkbox syntax.

**Goal:** Freeze resolved legal-entity branding with every newly committed sales, workshop, and vehicle-sale invoice, then generate and serve an immutable branded PDF archive from those frozen inputs.

**Architecture:** Extend the existing V2 financial snapshot additively with a validated V1 branding member and explicit `invoice-brand-v1` render version. Resolve branding and create its asset-retention reference inside the existing commitment transaction after acquiring locks in ADR-0023 order. Reuse the authenticated Cloud Tasks/Playwright PDF worker; publish branded PDFs with GCS create-only semantics and persist their exact generation and SHA-256 so retries can verify the winner and repair metadata after a crash.

**Tech Stack:** NestJS 11, TypeScript 7, Prisma 7, PostgreSQL, Google Cloud Storage, Cloud Tasks, Playwright PDF renderer, Jest, OpenAPI.

**Spec:** `docs/internal/02-Feature-Specs/Finance/document-branding-and-letterhead.md` (Snapshot and PDF Contract, State Machines and Concurrency, Testing Plan); `docs/internal/01-ADR/2026-09-27-legal-entity-document-branding.md`; `docs/internal/01-ADR/2026-09-20-legal-invoicing-and-accounting-export.md` (lock order and invoice commitment); Linear AUT-323.

## Global Constraints

- Keep financial `snapshot.schema_version` at 2; add only `branding.schema_version` 1 and preserve historical V1/V2 render paths.
- Newly committed invoices after activation, including default-branded invoices, freeze branding at the legal commitment transaction; never backfill committed history.
- Lock legal entity, site, tenant finance settings, source, invoice, and sequence in that order; acquire multiple asset locks in sorted order.
- Keep source/site authorization, guarded invoice transitions, stock effects, exact legal/margin content, and existing PDF completion notifications.
- Do not perform GCS, provider, or browser work while database commitment locks are held.
- Branded rendering reads only frozen snapshot data and exact retained GCS generations; it never resolves a live profile or substitutes missing assets, fonts, or renderer versions.
- GCS archive publication is create-only (`ifGenerationMatch: 0`); retries verify artifact identity and bytes before adopting it. Never overwrite an archive.
- Do not expose bucket, object key, object generation, logo locator, renderer internals, or private snapshot members in ordinary API DTOs.
- Follow red-green-refactor for each behavior; regenerate OpenAPI and frontend types if a public DTO changes.
- Deploy readers, retention, and create-only publication before enabling the new writer; rollback disables new branded issuance while preserving historical readers and retained evidence.
- Every focused unit-test cycle uses the repository-root Jest command shape `npm test --workspace=core-api -- --runInBand --runTestsByPath ... -t "..."`; each test-specific step below supplies its exact path and test-name filter. The red run must fail on the missing behavior, and the green run must pass.

---

### Task 1: Persist archive identity and asset-retention references

**Files:**
- Modify: `apps/core-api/prisma/schema.prisma`
- Create: `apps/core-api/prisma/migrations/20260928123000_immutable_invoice_branding_archive/migration.sql`
- Modify: `docs/deletion-policy.md`
- Create/test: `apps/core-api/test/invoice-branding-archive.e2e-spec.ts`
- Modify/test: `apps/core-api/src/document-branding/document-branding-upload-recovery.service.ts` and `.spec.ts`
- Modify/test: `apps/core-api/src/common/pdf/pdf-storage.ts`; create `apps/core-api/src/common/pdf/pdf-storage.spec.ts`
- Create: `docs/internal/03-Runbooks/document-branding-archive-rollout.md`

**Interfaces:**
- `Invoice` stores the archive bucket, key, GCS generation, SHA-256, and existing generated timestamp as one coherent branded archive identity. Metadata is written only after the exact winning object has been verified.
- `InvoiceBrandAssetReference` records tenant, legal entity, invoice, asset, and creation time. Composite foreign keys prevent cross-tenant or cross-entity references; one invoice has at most one logo reference.
- `PdfStorage` gains an immutable publication/read path that supplies generation and hash metadata, supports a generation-match-zero create, and can read/verify a specific generation. Each branded object stores custom metadata for tenant id, invoice id, SHA-256 of the exact frozen snapshot, template/renderer version, and SHA-256 of the PDF bytes. The key encodes tenant id, invoice id, snapshot hash, and template version. On conflict, the service verifies the deterministic key and metadata against the authorized DB invoice, reads the exact winning generation, and recomputes its PDF hash before adopting it. Historical `uploadPdf` behavior stays available for legacy documents.
- Committed references and branded archives have no application TTL and are excluded from short bucket lifecycle deletion.
- Expired asset cleanup rechecks `InvoiceBrandAssetReference` under the existing legal-entity lock before changing an asset to `DELETING` and before deleting its exact GCS generation; a relational FK alone is not treated as a cleanup guard.
- The current Terraform stack injects the invoice bucket name but does not own the bucket policy. The rollout runbook defines an explicit pre-writer verification against the configured bucket and writer/cleanup service identities; if it fails, the writer remains disabled.

- [ ] Add failing Prisma E2E cases in `apps/core-api/test/invoice-branding-archive.e2e-spec.ts` for a same-tenant/entity invoice-logo reference, cross-tenant and cross-entity composite-FK rejection, and duplicate invoice reference rejection.
- [ ] Add failing cleanup cases in `apps/core-api/src/document-branding/document-branding-upload-recovery.service.spec.ts` proving a committed invoice reference prevents transition to `DELETING` and prevents `deleteGeneration` even when cleanup is retried for an already-DELETING asset.
- [ ] Run the Prisma E2E case only against the fresh, unseeded CI database: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" npm run test:e2e --workspace=core-api -- --ci --runInBand --runTestsByPath test/invoice-branding-archive.e2e-spec.ts -t "invoice brand asset reference"`. Run the cleanup-service unit case with `npm test --workspace=core-api -- --runInBand --runTestsByPath src/document-branding/document-branding-upload-recovery.service.spec.ts -t "committed invoice reference"`; confirm failures identify absent relation and cleanup guards.
- [ ] Add failing storage cases in `apps/core-api/src/common/pdf/pdf-storage.spec.ts` proving create-only publication supplies generation-match-zero, a pre-existing object is not overwritten, reads return exact generation/hash, object custom metadata matches expected identity, byte hash is recomputed, and a missing/corrupt generation is unavailable.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/common/pdf/pdf-storage.spec.ts -t "immutable PDF archive"`; confirm failures report missing immutable storage behavior.
- [ ] Add additive schema fields, composite uniqueness/FKs, and the reference model; create a migration that does not backfill branding or archive hashes into historical invoices.
- [ ] Add the immutable storage operations while leaving the legacy PDF upload/read path unchanged.
- [ ] Update deletion policy so only a committed invoice reference protects the exact logo generation indefinitely and branded archive objects are never subject to short lifecycle rules.
- [ ] Add the rollout runbook with exact bucket inspection commands `gcloud storage buckets describe "gs://$INVOICE_PDF_BUCKET" --format=json` and `gcloud storage buckets get-iam-policy "gs://$INVOICE_PDF_BUCKET"`, where the bucket name is resolved from deployment configuration without printing secret values. State pass conditions: no lifecycle deletion covering retained logo/archive prefixes; uniform bucket access; writer has create/read but no delete or metadata-update permission; cleanup has only the narrowly scoped delete permission required for confirmed unreferenced exact generations; exact object generations are retained and hash-verifiable. Record the checked project, bucket, principal, and evidence date.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/document-branding/document-branding-upload-recovery.service.spec.ts src/common/pdf/pdf-storage.spec.ts`; require the referenced-asset cleanup race and immutable create/read/hash tests to pass. Then run `npm exec --workspace=core-api -- prisma validate` and `npm exec --workspace=core-api -- prisma generate`; require Prisma validation to exit 0 and regenerate the client from the new Invoice/reference schema.

### Task 2: Freeze and validate the branding snapshot at commitment

**Files:**
- Modify: `apps/core-api/src/invoices/invoice-snapshot-v2.ts`
- Modify/test: `apps/core-api/src/invoices/invoice-snapshot-v2.validation.ts` and `apps/core-api/src/invoices/invoice-snapshot-v2.spec.ts`
- Modify/test: `apps/core-api/src/invoices/invoice-snapshot-commit.service.ts` and `.spec.ts`
- Modify/test: `apps/core-api/src/invoices/invoice-snapshot.resolver.ts` and `.spec.ts`
- Modify/test: `apps/core-api/src/invoices/invoice-snapshot-render.adapter.ts` and `.spec.ts`
- Inspect/modify/test: `apps/core-api/src/site/document-retarget.helpers.ts`, `apps/core-api/src/invoices/invoices.service.ts`, `apps/core-api/src/sales/invoice-finalization.service.ts`, and `apps/core-api/src/vehicle-stock/vehicle-sale.service.ts`
- Modify/test relevant sales, workshop invoice, and vehicle-sale integration suites under `apps/core-api/test/`

**Interfaces:**
- `InvoiceSnapshotV2.branding` is absent only on historical records. New commits include schema version 1, nullable profile id/revision, `standard-v1`, `invoice-brand-v1`, `acp-sans-v1`, fully resolved tokens, nullable exact logo metadata, and `resolved_at` equal to the invoice snapshot commitment timestamp.
- A new renderer version without a valid branding object fails as corrupt input; it cannot fall through to V1/V2 legacy handling. Historical V1/V2 snapshots without branding remain valid and render exactly as before.
- The snapshot adapter preserves `template_version` and branding internally. Public DTOs continue to omit private object locators.
- The commitment preparation API first reads source-owned site/entity identifiers without taking row locks, locks the legal entity, then locks site, tenant finance settings, source, invoice, and sequence in order; it re-reads and revalidates source ownership, active entity/site, and authorization after locks. Profile creation, reset/confirm, cleanup, and issuance all serialize through that entity lock.
- The branded writer has an explicit configuration gate that defaults false. While false, no new invoice may legally commit through an unbranded fallback; the service returns a clear feature-unavailable response.

- [ ] Add validator tests in `apps/core-api/src/invoices/invoice-snapshot-v2.spec.ts` for valid defaults, valid confirmed profile, nullable profile/revision-zero defaults, malformed nested tokens/logo metadata, unknown branding versions, and `invoice-brand-v1` without branding.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/invoices/invoice-snapshot-v2.spec.ts -t "branding"`; confirm the new contract cases fail because branding validation is absent.
- [ ] Add resolver tests in new `apps/core-api/src/invoices/invoice-snapshot.resolver.spec.ts` and adapter tests in `apps/core-api/src/invoices/invoice-snapshot-render.adapter.spec.ts` proving branding/template version survive adaptation, historical V1/V2 take existing paths, and corrupt new-version snapshots raise `BRAND_RENDER_INPUT_UNAVAILABLE` without legacy fallback.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/invoices/invoice-snapshot.resolver.spec.ts src/invoices/invoice-snapshot-render.adapter.spec.ts -t "branding|historical|corrupt"`; confirm missing preservation/failure behavior.
- [ ] Add transaction tests proving each invoice origin freezes confirmed theme or ACP defaults and inserts its exact asset reference atomically with the financial snapshot and guarded status/number/stock changes.
- [ ] Add concurrency cases in `apps/core-api/src/invoices/invoice-snapshot-commit.service.spec.ts` and `apps/core-api/src/document-branding/document-branding.service.spec.ts` for missing-profile default commit versus first profile creation, profile confirm/reset versus invoice commitment, and asset cleanup versus invoice reference creation; assert entity lock is always acquired before child locks.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/invoices/invoice-snapshot-commit.service.spec.ts src/document-branding/document-branding.service.spec.ts -t "entity lock|cleanup|default profile"`; confirm the concurrency cases fail on current lock/retention behavior.
- [ ] Add the vehicle-sale regression in `apps/core-api/src/vehicle-stock/vehicle-sale.service.spec.ts`; record SQL/lock helper order and fail if the path acquires a site/source/sequence lock before the legal-entity lock.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/vehicle-stock/vehicle-sale.service.spec.ts -t "lock order"`; confirm it fails because vehicle-sale currently takes site/source/sequence state before the shared entity lock.
- [ ] Refactor all three origin paths only as required to obtain source-owned entity/site facts without taking out-of-order locks; revalidate ownership, active site/entity, fiscal date, source state, and seller/accounting evidence after locks.
- [ ] Resolve the active confirmed theme and READY asset metadata using tenant/entity ownership checks, copy only frozen canonical tokens and exact asset identity into the snapshot, and insert `InvoiceBrandAssetReference` in the same transaction.
- [ ] Add writer-gate cases named `writer gate disabled blocks commitment without fallback` to `apps/core-api/src/sales/invoice-finalization.service.spec.ts`, `apps/core-api/src/invoices/invoices.service.spec.ts`, and `apps/core-api/src/vehicle-stock/vehicle-sale.service.spec.ts`; verify false blocks sales, workshop, and vehicle-sale commitment with no snapshot/status/sequence/stock mutation and no legacy fallback.
- [ ] Run each red case before implementation: `npm test --workspace=core-api -- --runInBand --runTestsByPath src/sales/invoice-finalization.service.spec.ts -t "writer gate disabled blocks commitment without fallback"`; `npm test --workspace=core-api -- --runInBand --runTestsByPath src/invoices/invoices.service.spec.ts -t "writer gate disabled blocks commitment without fallback"`; `npm test --workspace=core-api -- --runInBand --runTestsByPath src/vehicle-stock/vehicle-sale.service.spec.ts -t "writer gate disabled blocks commitment without fallback"`. Confirm each fails because the gate does not yet block that origin.
- [ ] Keep all storage, network, and rendering calls outside the invoice commitment transaction.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/invoices/invoice-snapshot-commit.service.spec.ts src/document-branding/document-branding.service.spec.ts src/vehicle-stock/vehicle-sale.service.spec.ts -t "entity lock|cleanup|default profile|lock order|writer gate disabled"`; require the snapshots/reference atomicity, entity-before-child-lock order, profile/cleanup serialization, three writer-gate failures, and vehicle-sale order assertions to pass.

### Task 3: Render the versioned branded layout from frozen evidence

**Files:**
- Modify/test: `apps/core-api/src/invoices/invoice-snapshot.ts`
- Modify/test: `apps/core-api/src/invoices/invoice-pdf.renderer.ts` and `.spec.ts`
- Modify/test: `apps/core-api/src/invoices/invoice-pdf.layout.ts` and layout tests
- Modify/test: `apps/core-api/src/document-branding/assets/font-manifest.json`, `apps/core-api/package.json`, and `apps/core-api/scripts/copy-document-branding-assets.mjs`
- Modify/test: `apps/core-api/src/common/services/cloud-tasks.service.spec.ts`, `apps/core-api/src/common/guards/cloud-tasks-worker.guard.spec.ts`, `apps/core-api/src/common/pdf/pdf-task-tenant.guard.spec.ts`, `apps/core-api/src/invoices/invoice-pdf.generation.spec.ts`, existing PDF worker/task tests, and invoice completion-notification tests
- Create/test: `apps/core-api/test/invoice-branding-render.e2e-spec.ts` for real Playwright output and extracted PDF text

**Interfaces:**
- Renderer dispatch is explicit by historical/new template version. `invoice-brand-v1` uses bundled `acp-sans-v1` regular/bold font assets and the exact `standard-v1` geometry in the accepted spec.
- The branded renderer places only bounded logo/bands/decorative text in reserved chrome and renders seller/customer/tax/line/totals/pagination/margin-scheme content from the existing frozen financial snapshot without clipping or altering values.
- Renderer input accepts the exact stored logo bytes after the caller has verified tenant/entity reference, bucket/key, generation, MIME, dimensions, and SHA-256. It does not accept a live profile or URL.
- Missing/corrupt logo or versioned renderer/font evidence reports `BRAND_RENDER_INPUT_UNAVAILABLE` through existing PDF error reporting and leaves the invoice snapshot/archive unchanged.

- [ ] Add failing cases in `apps/core-api/src/invoices/invoice-pdf.renderer.spec.ts` for defaults and confirmed branding, version dispatch, text escaping, logo bounds, bundled font selection, and missing/corrupt logo/font/renderer evidence.
- [ ] Add `branded rendering never requests external resources` in `apps/core-api/test/invoice-branding-render.e2e-spec.ts`: use the actual Playwright page request listener and route to abort every `http:`/`https:` request; render default branding and a custom theme whose decorative text contains `https://attacker.example/logo.png`, then assert the request log is empty while embedded logo/font data URIs render. The test must fail if a token, logo, font, or template causes any remote request.
- [ ] Extend `cloud-tasks.service.spec.ts`, `cloud-tasks-worker.guard.spec.ts`, `pdf-task-tenant.guard.spec.ts`, and `invoice-pdf.generation.spec.ts` with invoice-worker contract cases: assert the queued invoice task contains the configured Cloud Tasks OIDC service account and audience plus existing worker-secret header; reject missing/invalid worker authentication, invalid HMAC, tenant-header mismatch, wrong task kind/resource id, and non-renderable invoice status; accept a valid signed invoice task and bind its tenant. Keep existing IAM/OIDC, HMAC, and status-check boundaries unchanged.
- [ ] Add failing PDF fixture assertions in `apps/core-api/src/invoices/invoice-pdf.layout.spec.ts` that compare protected financial/legal text and exact amounts for multi-page AT/DE STANDARD and enabled MARGIN_SCHEME invoices with long legal blocks.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/invoices/invoice-pdf.renderer.spec.ts src/invoices/invoice-pdf.layout.spec.ts src/common/services/cloud-tasks.service.spec.ts src/common/guards/cloud-tasks-worker.guard.spec.ts src/common/pdf/pdf-task-tenant.guard.spec.ts src/invoices/invoice-pdf.generation.spec.ts -t "branding|protected content|margin|invoice worker|OIDC"`; verify each new security/layout assertion fails for its expected missing behavior, not setup or import errors. Run the new no-outbound-request case as part of the E2E test step below, which uses the real browser.
- [ ] Implement branded chrome in the existing Playwright renderer/layout using the approved 16 mm side margins, 32 mm header reservation, 28 mm footer reservation, 3 mm bands, 45 × 18 mm logo box, and bounded decorative text; retain the existing layout implementation for old versions.
- [ ] Ensure decorative overflow is limited to header/footer text and cannot clip invoice lines, legal content, totals, or pagination.
- [ ] Validate exact retained logo generation/hash before rendering and route unavailable frozen evidence through the current PDF generation error and completion notification path.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/invoices/invoice-pdf.renderer.spec.ts src/invoices/invoice-pdf.layout.spec.ts src/common/services/cloud-tasks.service.spec.ts src/common/guards/cloud-tasks-worker.guard.spec.ts src/common/pdf/pdf-task-tenant.guard.spec.ts src/invoices/invoice-pdf.generation.spec.ts -t "branding|protected content|margin|invoice worker|OIDC"`; require zero failures and confirm invoice Cloud Tasks retain configured OIDC, signed tenant binding, and invoice-status enforcement. Run `npm run test:e2e --workspace=core-api -- --ci --runInBand --runTestsByPath test/invoice-branding-render.e2e-spec.ts -t "never requests external resources"`; require the actual Chromium request log to be empty for the URL-shaped decorative text fixture.
- [ ] Add `invoice-branding-render.e2e-spec.ts` using the repository's `PlaywrightBrowserService` and installed Chromium to render four synthetic fixtures: AT STANDARD with ACP defaults, AT STANDARD with confirmed custom tokens/logo, DE STANDARD with a ten-page long-legal-content invoice, and DE MARGIN_SCHEME with a ten-page invoice. Parse each returned PDF with the already-installed `pdfjs-dist`; assert page count, seller/customer/tax/payment/legal text, every line description, invoice number, pagination, and exact net/tax/gross totals match the source snapshot. Save PDF outputs under the test temp directory and delete them in `afterAll`.
- [ ] Run `npm run test:e2e --workspace=core-api -- --ci --runInBand --runTestsByPath test/invoice-branding-render.e2e-spec.ts`; require all four fixture cases to pass, with each assertion reporting the fixture name and expected versus extracted text/amount on failure.

### Task 4: Publish and serve immutable PDF archives with retry recovery

**Files:**
- Modify/test: `apps/core-api/src/invoices/invoice-pdf.service.ts` and `.spec.ts`
- Modify/test: `apps/core-api/src/invoices/invoice-pdf.generation.ts` and `.spec.ts`
- Modify/test: `apps/core-api/src/common/pdf/pdf-storage.ts` and its spec
- Modify/test: `apps/core-api/src/common/pdf/pdf-render-upload.ts` and its spec if the existing retry boundary needs versioned publication support
- Create/test: `apps/core-api/src/invoices/invoice-snapshot-hash.ts` and `apps/core-api/src/invoices/invoice-snapshot-hash.spec.ts`

**Interfaces:**
- Branded archive key is deterministic from tenant, invoice, snapshot identity, and template version; storage generation is create-only.
- `invoice-snapshot-hash.ts` applies RFC 8785 JSON Canonicalization Scheme to the persisted JSON value, then computes SHA-256 over canonical UTF-8 bytes. Object keys sort canonically, arrays preserve order, no whitespace is emitted, and no live fields are added. Hashing the initial snapshot and hashing the Prisma-read/re-serialized snapshot yield the same result; changing a frozen field or array order changes the digest.
- Each archive object carries custom metadata for tenant id, invoice id, SHA-256 of the frozen snapshot, template/renderer version, and PDF SHA-256; the deterministic key encodes tenant, invoice, snapshot hash, and template version. On create conflict, the service checks key and metadata against the authorized DB invoice, reads the exact winning GCS generation, recomputes its PDF SHA-256, and rejects any mismatch before adoption.
- On successful create, the service persists exact bucket/key/generation/SHA-256 and timestamp with a guarded conditional update. On generation-precondition conflict, it only conditionally persists metadata after the full identity and byte-hash verification above.
- A retry after object creation but before DB metadata persistence discovers and verifies the same object and repairs only DB metadata. A mismatch or unverifiable object is an explicit failure; bytes are never replaced.
- `getPdf` checks an existing branded archive first and returns its original bytes after existing active-site authorization. Repeated downloads read the pinned generation. Legacy invoices retain current cache/fallback behavior.

- [ ] Add failing cases in `apps/core-api/src/invoices/invoice-pdf.service.spec.ts` for archive cache hits, simultaneous render workers, GCS create winning before DB persistence failure, GCS precondition loss to a verified winner, wrong-identity conflict object, snapshot/template metadata mismatch, PDF byte-hash mismatch, and retry after metadata crash.
- [ ] Add download cases in `apps/core-api/src/invoices/invoice-pdf.service.spec.ts` proving repeated downloads stream the pinned archive generation, profile edits do not re-render or change bytes, and existing site authorization still rejects cross-site reads.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/invoices/invoice-pdf.service.spec.ts -t "archive|generation|hash|profile edit|site authorization"`; confirm missing immutable publication/recovery behavior.
- [ ] Add canonicalization cases named `canonical snapshot hash is stable across object property order`, `canonical snapshot hash changes when array order changes`, and `canonical snapshot hash survives JSON round trip` in `apps/core-api/src/invoices/invoice-snapshot-hash.spec.ts`.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/invoices/invoice-snapshot-hash.spec.ts -t "canonical snapshot hash"`; confirm each case fails because the canonical hash function is absent.
- [ ] Implement deterministic branded object identity, create-only publication, winner verification, conditional metadata persistence, and DB-only crash repair.
- [ ] Compute the archive key and recovery lookup from the same RFC 8785 canonical hash of the persisted invoice snapshot. In `apps/core-api/test/invoice-branding-archive.e2e-spec.ts`, read the committed JSON snapshot back from PostgreSQL and assert its hash matches the custom GCS identity metadata and object key.
- [ ] Keep old V1/V2 archive/cache behavior byte-for-byte compatible; existing archives remain authoritative and are never silently replaced.
- [ ] Preserve current PDF completion notifications and error reporting for both successful and unavailable-input outcomes.
- [ ] Run `npm test --workspace=core-api -- --runInBand --runTestsByPath src/invoices/invoice-pdf.service.spec.ts src/common/pdf/pdf-storage.spec.ts src/invoices/invoice-pdf.generation.spec.ts`; require the cache-hit, create-conflict, metadata-repair, pinned-generation, notification, unavailable-status, and hash-mismatch assertions to pass.
- [ ] Run `npm run test:e2e --workspace=core-api -- --ci --runInBand --runTestsByPath test/invoice-branding-archive.e2e-spec.ts -t "sales origin|workshop origin|vehicle-sale origin|cross-site|historical"`; for every origin, verify the persisted snapshot hash equals the deterministic object-key/custom-metadata identity, repeat download returns byte-identical archived bytes and SHA-256, and cross-site download returns 404 without reading storage. For legacy V1/V2 records, verify existing PDF generation/download behavior remains unchanged.

### Task 5: Verify full acceptance, API contracts, rollout, and repository gates

**Files:**
- Modify: `docs/internal/02-Feature-Specs/Finance/document-branding-and-letterhead.md` only to record implementation evidence/status, never to mark unverified product/accountant sign-off
- Modify: `docs/deletion-policy.md` if implementation review found the retention description incomplete
- Modify generated: `apps/core-api/openapi/openapi.json`, `apps/core-web/src/api/generated/openapi.ts` if the public invoice response contract changes; branded archive locators remain internal so no contract change is expected
- Add/modify: `apps/core-api/test/` invoice-flow and branded PDF E2E suites; approved synthetic render fixtures in the existing test fixture location

**Interfaces:**
- Acceptance evidence is a matrix, not a single shared-service unit test: one serial E2E case each for sales, workshop, and vehicle-sale proves ACP-default and confirmed-custom snapshots plus atomic exact-logo references; for each origin, edit and reset the profile after commitment, delay PDF generation, then prove snapshot/hash/archive bytes are unchanged on repeat download. Shared transaction tests prove entity-lock serialization for missing-profile default creation versus profile confirm/reset and cleanup versus reference creation; the three origin tests assert they all call the same locked commit helper before status/number/stock effects. PDF-service tests run two parallel workers and a simulated GCS-success/DB-update-failure/retry for an invoice fixture from each origin and prove one create-only object is adopted by exact generation/hash without overwrite.
- Legacy V1/V2 snapshots and PDFs are unchanged; no live seller or branding backfill occurs.
- Rollout order is: deploy legacy-compatible readers and generation/hash metadata migration; verify bucket lifecycle/IAM/retention with the rollout runbook; deploy create-only storage and branded archive readers while the writer flag is false; then enable the writer flag. While false, all new legal invoice commitments fail closed with a clear feature-unavailable response rather than creating an unbranded post-activation invoice. Rollback turns the flag off and keeps readers, fonts, renderer versions, logo objects, and archive bytes available.
- Public response DTOs expose no storage locators. If their shape changes, both generated contract files are committed.

- [ ] Add named serial E2E tests to `apps/core-api/test/invoice-branding-archive.e2e-spec.ts`: `sales origin freezes default and confirmed branding before invoice effects`, `workshop origin freezes default and confirmed branding before invoice effects`, `vehicle-sale origin freezes default and confirmed branding before invoice effects`, `profile edit and reset do not alter a delayed archived invoice`, `cross-site invoice download is rejected before storage access`, `legacy V1 and V2 invoice downloads preserve their existing paths`, and `each origin adopts the exact immutable archive after parallel render and metadata-repair retry`. Assert the snapshot's branding `resolved_at` equals its commitment timestamp, `InvoiceBrandAssetReference` matches the exact logo id, public responses omit snapshot and storage locators, and GCS fake records one create-only generation with matching snapshot/PDF hashes.
- [ ] Confirm `auto_core_test` is the disposable E2E database and has zero application tables/rows before migration using `psql "postgresql://postgres:postgres@localhost:5432/auto_core_test" -Atc "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'"` and `psql "postgresql://postgres:postgres@localhost:5432/auto_core_test" -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations'"`; both results must be `0`. Set `$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test"` in the PowerShell session, run `npm exec --workspace=core-api -- prisma migrate deploy`, then `npm run test:e2e --workspace=core-api -- --ci --runInBand --runTestsByPath test/invoice-branding-archive.e2e-spec.ts -t "sales origin|workshop origin|vehicle-sale origin|profile edit and reset|cross-site|legacy V1 and V2|parallel render"`; remove the process-local environment variable afterward. Never use the local `.env` database or seed this database.
- [ ] Verify the E2E output reports every named origin/race/download case passing; query PostgreSQL for the exact persisted snapshot and asset reference, and have the fake GCS adapter assert the deterministic key, generation, metadata identity, PDF SHA-256, and byte-identical repeated download for all three origins.
- [ ] Run the four actual-browser visual fixtures from Task 3 with `npm run test:e2e --workspace=core-api -- --ci --runInBand --runTestsByPath test/invoice-branding-render.e2e-spec.ts`; require AT default/custom, DE ten-page STANDARD, and DE ten-page MARGIN_SCHEME to preserve all specified protected text and exact totals. Record fixture filenames, renderer/font manifest versions, page counts, and extracted text/amount assertions in the test output; do not claim product/accountant visual sign-off, which remains a later release gate.
- [ ] Regenerate OpenAPI and frontend generated types only if public contract metadata changed, then run the contract drift check and confirm no internal locator is serialized.
- [ ] Add `INVOICE_BRANDING_WRITER_ENABLED` configuration that defaults false in all environments and test that false blocks all three invoice commitment paths without legacy fallback; enabling it requires completed runbook evidence for bucket, retention, readers, and create-only publication.
- [ ] Run mandatory backend checks and retain each exit code/output: `npm exec --workspace=core-api -- prisma generate`; `npm run lint:prisma-tenant --workspace=core-api`; `npm run lint --workspace=core-api`; `npm run build --workspace=core-api`; `npm test --workspace=core-api -- --ci --runInBand`; then migrate and run the specified E2E cases on the fresh, unseeded database. Every command must exit 0 and backend Jest output must report zero failed suites/tests.
- [ ] Run mandatory frontend checks: `npm exec --workspace=core-web -- playwright install --with-deps chromium`; `npm run lint --workspace=core-web`; `npm run build --workspace=core-web`; `npm test --workspace=core-web`; `npm run test:e2e --workspace=core-web`; and `npm run api:types:check --workspace=core-web`. Every command must exit 0; record existing warnings separately from errors. If public API metadata changes, run OpenAPI and frontend type generation before the type check.
- [ ] Review the migration and rollout/rollback instructions for additive deployment order. Before enabling the writer, run the bucket describe/IAM commands in `docs/internal/03-Runbooks/document-branding-archive-rollout.md` and attach evidence that lifecycle excludes retained prefixes and service principals cannot delete/replace committed archive generations; do not enable the writer if any evidence is absent.
- [ ] Commit the complete AUT-323 implementation as one commit, create a draft PR, wait for every CI check, mark it ready only after all checks pass, address review comments, and verify merge before starting AUT-324.

## Self-review

- Spec coverage: branding snapshot shape, defaults, asset reference retention including the actual recovery cleanup path, lock ordering, all three origins, historical V1/V2, branded renderer/font versioning, protected content, RFC 8785 snapshot hashing, immutable GCS publication, concurrent retries, crash recovery, pinned-generation downloads, authorization, notifications, archive retention, contract privacy, rollout, and rollback are assigned to the tasks above.
- No placeholders: all implementation and verification steps identify specific behaviors, paths, data, or commands. Focused unit-test red/green commands are specified per behavior group.
- Type consistency: branded template is `invoice-brand-v1`; branding member is schema version `1`; financial snapshot stays schema version `2`; unavailable evidence uses `BRAND_RENDER_INPUT_UNAVAILABLE`; archive identity records bucket/key/generation/SHA-256.
