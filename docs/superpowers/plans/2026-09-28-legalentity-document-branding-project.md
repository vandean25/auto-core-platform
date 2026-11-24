# LegalEntity Document Branding Project Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to execute issue work. Each Linear issue gets its own red-green-refactor cycle, PR, CI gate, review-fix loop, and merge verification. Steps use checkbox syntax.

**Goal:** Complete all remaining implementation and release gates in the LegalEntity Document Branding & Letterhead project, in dependency order, and merge each issue's PR only after CI and review feedback are resolved.

**Architecture:** Preserve the accepted AUT-317/AUT-318 decisions: branding belongs to `LegalEntity`, ACP owns invoice structure and legal content, and the existing authenticated Playwright PDF worker remains the rendering path. Finish AUT-322's review findings first, then implement immutable invoice branding (AUT-323), gated extraction (AUT-324), and business/release acceptance (AUT-325). The project dependency chain is AUT-317 → AUT-318 → AUT-322 → AUT-323 → AUT-324 → AUT-325; AUT-317/AUT-318 are already Done, while the numeric milestone labels do not override this dependency order.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL, Google Cloud Storage, Cloud Tasks, React 19, TanStack Query, Playwright PDF worker, OpenAPI, Jest, Vitest, and Playwright.

**Spec:** `docs/internal/02-Feature-Specs/Finance/document-branding-and-letterhead.md`; `docs/internal/01-ADR/2026-09-27-legal-entity-document-branding.md`; Linear AUT-317, AUT-318, AUT-322, AUT-323, AUT-324, and AUT-325.

## Global Constraints

- Keep `LegalEntity` ownership, tenant/site authorization, ACP-owned invoice body, no user-supplied HTML/CSS/JS, and existing ADR-0007 PDF processing.
- Issued invoice render inputs and archived bytes remain immutable; never resolve a historical render from today's profile or asset pointer.
- Every change follows test-first red-green-refactor; backend API contract changes regenerate both OpenAPI and frontend generated types.
- Each issue is a separate one-commit PR. Open as draft, mark ready only after all CI checks pass, implement actionable review comments, and merge only after the current head is green and merge requirements are satisfied.
- Never fabricate provider/operations, PO, or accountant approvals. Keep gated activation/release incomplete until the named evidence is recorded.

---

### Task 1: Resolve AUT-322 review findings — complete

**Files:**
- Modify: `apps/core-api/src/document-branding/document-branding-upload-worker.controller.ts`
- Test: `apps/core-api/src/document-branding/document-branding-upload-worker.controller.spec.ts` (or the existing module/controller test if that is the repository pattern)
- Modify/test: `apps/core-api/src/document-branding/document-branding.service.ts`, `apps/core-api/src/document-branding/document-branding.service.spec.ts`, and `apps/core-api/src/document-branding/dto/document-branding.dto.ts`
- Modify/test: `apps/core-api/src/document-branding/document-branding-upload-worker.service.ts` and `apps/core-api/src/document-branding/document-branding-upload-worker.service.spec.ts`
- Modify/test: `apps/core-api/src/document-branding/document-branding-pdf-parser.ts` and `apps/core-api/src/document-branding/document-branding-pdf-parser.spec.ts`
- Modify/test: `apps/core-api/src/document-branding/theme-v1.ts` and `apps/core-api/src/document-branding/theme-v1.spec.ts`
- Modify/test: `apps/core-api/src/document-branding/document-branding-upload.service.ts` and its spec
- Modify/test: `apps/core-api/test/document-branding.e2e-spec.ts`
- Modify/test: `apps/core-web/src/api/document-branding.ts`, `apps/core-web/src/components/settings/document-branding/DocumentBrandingSettings.tsx`, and the corresponding tests
- Regenerate: `apps/core-api/openapi/openapi.json`, `apps/core-web/src/api/generated/openapi.ts`

**Interfaces:**
- The signed Cloud Tasks upload worker is public to Firebase JWT auth but remains protected by both Cloud Tasks OIDC and branding task binding guards.
- A missing profile reads as virtual revision `0` without a database write; the first mutation with `expectedRevision: 0` persists revision `1`.
- READY publication either records the exact published GCS generation or deletes that exact generation if the conditional database transition fails or any later operation throws before the asset is safely READY.
- The isolated PDF parser never leaves a child-process stderr pipe undrained; hostile output cannot block the bounded parser process.
- Input PNGs exceeding 8,192 pixels per side or 16 megapixels are rejected with the specified dimension error and never published.
- Quota responses provide `Retry-After`; color contrast failures use `BRAND_COLOR_CONTRAST`; asset status polling stops after 120 seconds and offers manual refresh.
- Cross-tenant and cross-entity profile/asset metadata/content lookups return 404.

- [x] Add failing tests for public worker metadata, profile revision-0 reads/first writes, READY-publish rollback for both a lost conditional update and a later thrown error, parser stderr pipe handling, PNG pixel-limit error handling, contrast error code, quota retry header, bounded polling/manual refresh, and tenant/entity HTTP isolation.
- [x] Run each focused test and verify it fails for the reported behavior before production edits.
- [x] Implement the smallest fix for each confirmed root cause and keep each focused test green before the next finding.
- [x] Regenerate OpenAPI and generated frontend types after allowing zero-valued revisions; verify contract drift is clean.
- [x] Run backend unit/lint/build/e2e, frontend test/lint/build/e2e, contract, tenant-isolation, and repository CI checks.
- [x] Push the amended single commit, keep the PR draft until the refreshed CI run passes, respond to every review thread, and merge after review/branch protection requirements were met. PR #597 merged at `d578da93e2d7be514462b5bbddf4dca529bda86b`.

### Task 2: Implement AUT-323 immutable invoice snapshots and PDF archives

**Files:**
- Inspect and map the shared invoice commitment path, invoice validators, renderer adapters, Cloud Tasks PDF worker, archive storage, and lock-order helpers before editing.
- Modify the invoice-origin paths for sales, workshop, and vehicle-sale invoices, the existing invoice PDF worker/storage path, and their transaction, unit, and E2E tests.
- Modify Prisma schema/migration and deletion/retention rules for frozen branding inputs and immutable archive metadata only after the exact reference relationships are mapped.
- Regenerate OpenAPI/frontend generated types if invoice DTOs change.

**Interfaces:**
- At first legal commitment, snapshot either ACP defaults or the complete confirmed ThemeV1 plus exact logo asset generation and render/font versions.
- Preserve site authorization, existing V1/V2 renders, protected invoice content, and existing completion notifications.
- Publish invoice archives with GCS create-only preconditions; retries verify/adopt the winning artifact and recover a DB-metadata crash without replacing archived bytes.
- Deploy readers, retention, and immutable storage before enabling the writer; document a rollback that preserves issued evidence.

- [ ] Create an issue-specific AUT-323 plan from the complete approved spec and current transaction/PDF call graph; submit it for plan review before editing. Plan: `docs/superpowers/plans/2026-09-28-aut323-immutable-invoice-branding-snapshots-and-pdf-archives.md`.
- [ ] Add failing transaction, render, concurrency, crash-recovery, multi-origin, and historical-immutability tests before code changes.
- [ ] Implement AUT-323 in a separate one-commit branch/PR, run the repository-mandated checks, and resolve review comments until merged.

### Task 3: Implement AUT-324 ACP-managed letterhead extraction

**Files:**
- Create the extraction persistence/service/task/controller/API surface and tests under `apps/core-api/src/document-branding/`.
- Extend `apps/core-api/src/document-branding/document-branding-asset-storage.ts` and the existing settings API/component/tests for status, proposal review, edit, confirm, and discard.
- Add the required schema migration and regenerate OpenAPI/frontend generated types.
- Store provider credentials only through the existing Google Secret Manager mapping/workflow; do not add tenant BYOK settings.

**Interfaces:**
- Outbound extraction stays disabled until product/operations record and approve the exact provider/model/version, processing region, data terms/retention, cost cap, and sandboxed parser package/version, and attach one approved extraction fixture.
- Jobs are tenant/entity-safe, asynchronous, leased, idempotent, quota-limited, recoverable, expiring, and have no publication authority.
- Send only a normalized first-page image and fixed schema prompt; validate output; server-side crop suggestions create bounded logo assets. Model output cannot select URLs, asset IDs, markup, tools, or active state.
- Provider failure, stale proposals, discarded work, expired jobs, or revoked authorization leave the active profile unchanged; the manual flow works while extraction is disabled.

- [ ] Record the provider activation evidence gate and attach one approved extraction fixture before enabling outbound calls; keep the feature disabled if evidence is incomplete.
- [ ] Create an issue-specific AUT-324 plan and submit it for plan review before edits.
- [ ] Add failing mock-provider, malformed/injected output, retry, duplicate, expiry, discard, authorization-loss, logging-privacy, and human-confirmation tests.
- [ ] Implement and verify in a separate one-commit PR; resolve review comments until merged.

### Task 4: Complete AUT-325 visual acceptance and release gates

**Files:**
- Generate synthetic rendered fixtures and retain evidence under the project's approved test-artifact/documentation location.
- Update `docs/internal/02-Feature-Specs/Finance/document-branding-and-letterhead.md` acceptance checkboxes only from actual verified evidence.
- Link CI/security/visual artifacts and deployment/rollback/recovery evidence back to AUT-325.

**Interfaces:**
- Exercise defaults and branded AT/DE standard plus every enabled margin profile, long legal fields, 120-character decorative text, transparent/tall/wide logos, every band, and a ten-page invoice.
- Verify readable protected content, tenant/entity/site isolation, hostile upload bounds, draft/confirm races, immutable asset retention, and concurrent archive publication/crash recovery.
- Record renderer/font versions, artifact links, reviewer/date, PO and accountant decisions, and provider/operations activation approval. No assumed or synthetic approval counts as sign-off.

- [ ] Create an issue-specific AUT-325 evidence plan after AUT-324 is merged and submit it for plan review.
- [ ] Produce the full fixture set and verify every listed security, rendering, concurrency, retention, deployment-order, monitoring, cleanup, and rollback criterion.
- [ ] Obtain and record real PO/accountant and product/operations approvals; if unavailable, leave this release gate open and report the exact missing approval.
- [ ] Mark AUT-325 and the Linear project complete only after all dependencies, evidence, and approvals are verified.

---

## Current Evidence

- AUT-317 and AUT-318 are Done in Linear.
- AUT-322 PR #597 is merged after all required checks passed and its review feedback was addressed; merge commit is `d578da93e2d7be514462b5bbddf4dca529bda86b`.
- AUT-323 implementation plan is drafted for reviewer approval on branch `feature/aut-323-immutable-invoice-branding-snapshots-and-pdf-archives`, based on current `origin/main` at the AUT-322 merge commit.
- AUT-324 and AUT-325 remain queued behind AUT-323 and its approved dependencies.
