---
title: "DATEV Accounting Export"
date: "2026-09-20"
module: "Finance"
status: draft
linear-project: "https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695"
linear-milestone: "0 — Spec & ADR; delivery milestone 4"
tags: [feature-spec, finance, accounting, export]
---

# DATEV Accounting Export

## Summary

OWNER/ADMIN users export a complete closed period for one legal entity as a reproducible DATEV Buchungsstapel artifact built from immutable invoice and credit facts. This spec depends on [[legal-invoicing-and-credit-notes]] and [[2026-09-20-legal-invoicing-and-accounting-export|ADR-0023]]. It defines accounting mappings early enough for milestone 1 snapshots; export delivery is milestone 4. It is a proposal, not a claim that current ACP data or a generated file already passes DATEV validation.

### Scope

Must-have: explicit per-entity mapping/profile, closed-period preview, complete preflight diagnostics, stable booking rows, exact download replay, tenant/site authorization, and audit trail. Initial enabled profile: DE, EUR, domestic STANDARD VAT with accountant-approved ordinary revenue postings. AT and MARGIN_SCHEME posting recipes are separate activation gates; if encountered they block the entire selected export rather than disappear from it.

Out of scope: purchases/AP, incoming payments, refunds, cash/card registers, partial payments, customer balance management, DATEV API/OAuth/upload, payment reconciliation, foreign currency conversion, e-invoice XML, stock/vehicle cost postings, automated import confirmation, reverse-charge and exempt regimes. This is a sales-document booking export, not a general-ledger trial balance or complete business accounting.

## User Stories

- As an OWNER/ADMIN, I configure each entity's accountant profile and revenue mapping before new invoices are finalized.
- As an accountant-facing operator, I preview a closed date range and see blockers before downloading an incomplete file.
- As an accountant, I receive original invoices and dated commercial credits with frozen accounts, tax treatment and traceable document references.
- As an auditor, I can retrieve the exact file produced by a named user at a specific time, even after mappings change.

### Journey

1. Settings → Finance → Accounting export. Configure legal entity profile, fiscal-year start, adviser/client identifiers, chart/account length, default debtor account and revenue mappings. Save with 750 ms autosave and visible status. Profile starts inactive until its import fixture is approved.
2. Choose one legal entity and `dateFrom`/`dateTo`. Preview resolves authorized sites and returns counts, totals by document kind/rate/account, profile version and all blocking documents visible to the caller. It does not advance fiscal lock or mutate documents.
3. If period is not closed, explain that Finance must close it through the existing separately confirmed lock-date flow. Export never advances the lock automatically.
4. Generate after a valid preview. The server repeats authorization/preflight and rejects stale preview/profile hashes. Persist exact CSV bytes, profile, manifest and checksum in one immutable run. Then offer Download.
5. Run history shows entity, period, user, document count, created time and checksum. Redownload uses the same bytes. Overlapping/repeated runs are labeled clearly; the UI states that importing both can duplicate bookings.

## Database Impact

### New Tables / Columns

| Table | Column | Type | Nullable | Notes |
|---|---|---|---|---|
| `legal_entity_accounting_profiles` | `id`, `tenant_id`, `legal_entity_id`, `version`, `is_enabled` | UUID / UUID / UUID / Int / Boolean | No | One current row per entity; tenant-safe FK, audit changes; snapshots freeze each used version. |
| Same | `profile_code`, `format_version`, `chart`, `account_length`, `advisor_number`, `client_number`, `fiscal_year_start_month`, `default_debtor_account` | Strings / Ints | Until enabled | Preserve identifiers as strings; profile code `ACP-DATEV-DE-EUR-1`; account/date limits validated against pinned format. |
| Same | `mapping_rules` | JSON | No | Explicit source-category + tax-mode/rate → revenue account + automatic-tax or explicit-BU treatment; initialized empty, not fabricated. |
| `accounting_exports` | `id`, `tenant_id`, `legal_entity_id`, `created_by_user_id`, `createdAt` | UUIDs / timestamp | No | Immutable completed artifact only; actor FK retained. |
| Same | `date_from`, `date_to`, `profile_snapshot`, `document_manifest`, `site_ids` | Date / Date / JSON / JSON / JSON | No | Frozen request, config, invoice/credit IDs + snapshot hashes, scope; manifest sorted. |
| Same | `file_bytes`, `file_sha256`, `byte_length`, `row_count`, `document_count` | Bytes / String / Ints | No | Exact CSV stored in Postgres for bounded slice 1; no new file-storage platform. |
| Same | `idempotency_key`, `request_hash` | Strings | No | Unique tenant/key; same-body retry returns original run. |
| Existing `AuditLog` | export generation/download event payload | Existing JSON | Existing | Actor, entity, range, run ID, checksum; no full invoice/bank/customer payload in logs. |

All new relations carry `tenant_id` and tenant-safe composite FKs. Index runs `(tenant_id,legal_entity_id,createdAt)` and profiles `(tenant_id,legal_entity_id)`. The profile's fiscal-year start must match the existing tenant FinanceSettings in slice 1; differing entity fiscal years require a later scope decision. Existing `FinanceSettings.lock_date` remains tenant-wide.

Mapping keys use stable source category identifiers when available. Explicit keys for labor, manual lines and vehicle margin avoid assuming every billable line has a CatalogItem. Existing `RevenueGroup.account_number` can prefill the settings editor, but **never** acts as a runtime fallback at export. Admin must confirm the entity-specific mapping. A renamed/deleted group does not invalidate already frozen line mappings.

Each committed line's `accounting_snapshot` records profile code/version, source category ID (nullable) and label, revenue account, debtor account, VAT rate/treatment, BU key or automatic-account flag, country and currency. Profile/category resolution happens before issuance using batched tenant-scoped reads. Credits copy this allocation from the original. Incompatible chart/account-length changes require a new effective profile and explicit preview blocker for periods mixing incompatible facts; never remap historical lines silently.

**M1 decision: keep the mapping prerequisite. Milestone 1 cannot ship without accountant-approved mapping fixtures for each enabled invoice profile.** M1 delivers profile configuration, source-category resolution and frozen accounts/tax treatment under AUT-297–299; AUT-307 consumes these in M4. New v2 `accounting_snapshot` is required at issuance, with `ACCOUNTING_MAPPING_INCOMPLETE` for incomplete configuration. `is_enabled` gates only CSV generation: an approved mapping can support issuance while the serializer remains disabled. Margin invoices freeze internal cost/tax facts and approved category allocation even while the DATEV margin posting recipe is disabled. Seller identity/PDF rollout therefore waits for M1 mapping approval, but does not wait for M4 serializer/import implementation.

### Modified Tables

| Table | Change | Migration Required? |
|---|---|---|
| InvoiceItem / Invoice snapshot | Frozen accounting allocations required for v2 issuance, delivered in milestone 1 | Yes; shared with invoicing spec |
| Tenant / LegalEntity / User | Reverse relations to profile and immutable runs | Yes |
| RevenueGroup | Existing label/account remains tenant master data; no export-time joins | No |
| AuditLog | Existing append-only event system reused | Only if implementation needs an event enum addition |

### Deletion Policy Impact

Profile updates are allowed; no delete API after first use. Export artifacts and audit events are immutable with no ordinary deletion endpoint. Retain exact CSV bytes in Postgres within the 20 MiB/10,000-document run bounds; long-term retention/offload is out of scope and requires an approved policy, never an ad-hoc TTL or cleanup job. Proposed rows are documented in `docs/deletion-policy.md` pending ADR approval.

## Selection, Authorization and Financial Rules

1. Require OWNER/ADMIN and active TenantMember. Resolve every site contributing documents to the entity/range using a named `listAccountingExportSites()` helper and validate active SiteMembership for each. An entity ID or site filter is not authorization. Missing access blocks the entire entity export with 403 `EXPORT_SCOPE_INCOMPLETE`; do not reveal unauthorized IDs, counts or amounts. For slice 1, inactive contributing sites also block until historic access is explicitly designed.
2. Require inclusive date-only range `dateFrom ≤ dateTo`, within one fiscal year, and `dateTo ≤ lock_date`. Null lock or an open date returns 422 `EXPORT_PERIOD_NOT_CLOSED`. Read-only export of a locked period is allowed; it does not create a backdated fiscal transaction.
3. Select invoices by frozen invoice date and credits by their own frozen credit date. Include version-2 FINALIZED/ISSUED/PAID invoices and FINALIZED credits. Exclude DRAFT and VOID. A fully credited invoice remains a positive original booking, with separate credit entries at credit dates. Never drop the original because its balance is zero.
4. Any candidate with missing ownership/evidence, legacy CANCELLED status, unsupported profile/tax mode, missing mapping, inconsistent totals or unrepresentable format fields blocks the whole run. An unresolved-ownership legacy invoice in the tenant/range conservatively blocks generation for any entity until remediation; only disclose its details when authorized.
5. No inference of account from current `revenue_group_name`; no recalculation from current tax rates/prices. Do not export payments based on PAID status.
6. Cap one run at **10,000 documents and 20 MiB encoded CSV** for slice 1; return 422 `EXPORT_RANGE_TOO_LARGE` asking for a shorter closed range. Batch queries; no awaited DB query per line. Use a consistent transaction snapshot to build the manifest, and recheck permissions/profile/lock before persisting it. Membership/profile updates racing generation require conflict detection/retry so a revoked caller cannot commit an export.
7. CSV bytes, manifest, profile and creation audit event commit atomically. A serialization/storage failure creates no completed run. The download audit is separate; log that bytes were served, not that DATEV imported them. Reauthorize every run read/download against its saved site set and current tenant membership.

## DATEV File Contract

### Chosen target and verification boundary

Proposed target: **EXTF 700 / data category 21 / Buchungsstapel format 13**, named `ACP-DATEV-DE-EUR-1`. AUT-307 must pin the official field-order/schema revision and validate it with the accountant's importer. The official [DATEV format portal](https://developer.datev.de/portal/de/dtvf) could not be fetched on 2026-09-20; this draft does not certify the version or reproduce an unverified column count. An older indexed DATEV PDF also returned 404. Acquiring the authoritative format and an import fixture is a release prerequisite, not permission to guess a positional schema.

Proposed serialization rules to confirm against that pinned schema: semicolon-separated CSV, CRLF, Windows-1252 without BOM, decimal comma with two money places/no thousands separator, quoted text with doubled embedded quotes, and exactly the official header/data column count including empty optional fields. Reject unencodable characters and overlength document/account references with field-specific errors; never truncate identifiers silently. Treat CSV as an import artifact, not an Excel formula document; free text must reject formula-leading control content and normalize CR/LF without changing fiscal identifiers.

### Header and row mapping

Produce one EXTF administration header, the complete official column-name row and complete positional data rows. The following is ACP's semantic mapping, **not** a shortened CSV layout:

| DATEV field | ACP source / rule |
|---|---|
| Format identifiers | Pinned EXTF/Buchungsstapel version constants |
| Created timestamp / producer | Frozen run creation timestamp and ACP producer identifier |
| Beraternummer / Mandantennummer | Frozen entity export profile |
| WJ-Beginn / Sachkontenlänge | Fiscal-year start containing selected range / profile account length |
| Datum von / Datum bis / Währung | Frozen range / EUR |
| Festschreibung | Proposed 0 (unfixed import batch), subject to accountant fixture; ACP fiscal close does not assert a DATEV posting was fixed |
| Umsatz (ohne Soll/Haben-Kz) | Positive frozen **gross** amount for an ordinary taxed revenue line |
| Soll/Haben-Kennzeichen | `S` for original invoice debit to debtor; `H` for credit to same debtor |
| Konto | Frozen debtor account; slice 1 uses accountant-approved collective debtor, not an invented per-customer ledger |
| Gegenkonto | Frozen revenue account |
| BU-Schlüssel | Frozen explicit key when mapping uses manual tax handling; empty for approved automatic-tax account; never both mechanisms |
| Belegdatum | Frozen document date in required DATEV representation, interpreted in header fiscal year |
| Belegfeld 1 | This invoice/credit's own number |
| Belegfeld 2 | Left empty in slice 1; do not misuse a due-date-sensitive field for original reference |
| Buchungstext | Bounded deterministic document reference; credits include original invoice number; verbose labels remain in manifest |
| Generalumkehr | Unset; credit polarity alone reverses posting; no double reversal |
| Other fields | Empty only where official profile permits; no arbitrary values |

One row per frozen line allocation; do not merge separate documents. Sort by document fiscal date, document kind, number, UUID and stable original line ID. Omit zero-gross lines from booking rows but retain them in the manifest and counts. No separate VAT booking row when the selected DATEV tax treatment already generates tax. Validate import VAT against frozen tax buckets; if the importer rounds differently, block profile activation until the posting recipe reproduces ACP totals exactly.

Example acceptance fixture: an invoice with two allocated lines `(net 100.00, tax 19.00, gross 119.00)` and `(net 50.00, tax 3.50, gross 53.50)` produces two positive gross rows with `S`, each using its approved rate-specific mapping. A credit of the first full line produces `119,00` with `H`, its CN number and original RE reference. Signed gross totals are `172.50 − 119.00 = 53.50`; tax reconciliation is `22.50 − 19.00 = 3.50`. The specific account/BU values must come from the approved profile fixture, not sample production defaults.

MARGIN_SCHEME requires a separately reviewed multi-posting recipe using the frozen cost/margin facts; a gross sale booked as ordinary VAT revenue is forbidden. Its presence in the first DE ordinary-VAT profile returns `UNSUPPORTED_EXPORT_TAX_MODE`, with no partial CSV. AT likewise requires an approved target-import profile, not just changing the currency/country label.

### Replay, duplicates and empty periods

Same idempotency key + same canonical request returns the same run ID and exact bytes; changed request returns 409. Redownload does not regenerate a timestamp/header. A new explicit run for an overlapping period is permitted only after preview shows overlap and request sets `acknowledgeOverlap=true`; it receives a new run ID and creation audit, and does not mark anything “already booked”.

Empty valid period: preview shows 0 documents/rows, generation returns 422 `EXPORT_EMPTY_PERIOD`; no artifact or misleading success. A document with all-zero bookings is retained in preview; a range producing zero rows follows the same empty behavior.

## API Contract Changes

### New Endpoints

| Method | Route | Request Body | Response | Auth |
|---|---|---|---|---|
| GET / PATCH | `/api/legal-entities/:id/accounting-profile` | PATCH editable profile fields + `expectedVersion` | Profile/version/readiness | OWNER/ADMIN, tenant-scoped |
| POST | `/api/finance/accounting-exports/preview` | `{legalEntityId,dateFrom,dateTo}` | counts, signed totals by account/rate, profileVersion, previewHash, blockers, overlap run summaries | OWNER/ADMIN + complete authorized scope |
| POST | `/api/finance/accounting-exports` | Preview request + `{previewHash,profileVersion,idempotencyKey,acknowledgeOverlap}` | 201 `{id,filename,sha256,documentCount,rowCount,createdAt}` | Same, revalidated |
| GET | `/api/finance/accounting-exports` | Query page/limit/search/sort/entity | `{data,meta}`; only fully authorized runs | Same |
| GET | `/api/finance/accounting-exports/:id` | — | Metadata and authorized manifest, no raw bytes | Same |
| GET | `/api/finance/accounting-exports/:id/download` | — | Binary CSV, attachment filename, no-store, checksum metadata | Same |

Preview errors return 200 with authorized business blockers when scope is valid; auth/syntax errors use 403/404/400. Generation with stale preview/profile returns 409 `EXPORT_PREVIEW_STALE`; invalid closed-period/content/profile requirements return 422. Foreign-tenant resource IDs return 404. Incomplete site access returns a generic 403. Downloads never embed permanent publicly accessible links.

`previewHash` covers range, profile version, sorted candidate IDs/snapshot hashes, and included site set. The server always recomputes it; a hash is not an authorization credential. Filename: `EXTF_<entity-id>_<from>_<to>_<run-id>.csv`, using server-controlled identifiers.

### Modified Endpoints

No existing endpoint is replaced. Legal invoice DTO/snapshot changes are owned by the companion spec. Add the export panel to existing Finance settings navigation. Do not change lock-date semantics as a side effect of export.

### OpenAPI Regeneration

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`
- [ ] Commit both generated artifacts and run frontend `api:types:check` during implementation.

## UX Compliance

- [ ] Page title/subtitle uses standard typography; Preview/Generate/Download actions top-right; selected entity and period context top-left.
- [ ] Profile forms autosave at 750 ms with Saving/Saved/Error; generation waits for successful save. Isolated text edits use InlineEdit.
- [ ] Run history uses shared DataTable, global search over visible entity/period/actor/run fields, sortable columns, row-click details and consistent widths.
- [ ] Runs are completed immutable records; no artificial job status enum and no Delete context menu. If a readiness/status chip is shown, use StatusBadge.
- [ ] Preview lists all visible blockers and actionable settings links; never offers “export valid rows only”. Unauthorized scope receives no leaked totals.
- [ ] Overlap confirmation explains duplicate import risk; no promise that ACP knows DATEV import state.

### Real-Time Sync

No dashboard entity broadcast for AccountingExport in slice 1: it contains multi-site financial metadata and has no operational dashboard effect. Invalidate `accountingExportKeys` after local mutations; refresh history on focus. Profile changes invalidate authorized settings and stale previews by version. Never publish multi-site manifests into a single site or broad tenant room.

## Component Design

| Component | Location | Purpose |
|---|---|---|
| AccountingExportSettingsTab (new) | `apps/core-web/src/components/settings/AccountingExportSettingsTab.tsx` | Profile, preview and immutable history |
| SettingsPage (modify) | `apps/core-web/src/pages/SettingsPage.tsx` | OWNER/ADMIN entry point |
| Export hooks (new) | `apps/core-web/src/api/useAccountingExports.ts` | Generated contracts, shared key factory, download errors |
| Export service/controller (new) | `apps/core-api/src/finance/accounting-export/` | Scope, closed-period checks, manifest, audit and replay |
| DATEV serializer (new) | Same feature directory | Pure deterministic mapping from frozen facts to pinned CSV profile |

## Impact Analysis

| Dimension | Required treatment |
|---|---|
| Database | Profile + immutable bounded binary artifact; no payment/ledger tables |
| State machines | No invoice mutations; profiles have versions, runs appear only after successful atomic generation |
| Deletion | No ordinary run/profile deletion after use; immutable audit |
| Realtime | Explicit local refetch; no multi-site financial broadcast |
| API | New profile/export routes with generated contracts |
| Inventory | None; no stock/cost side effects |
| Finance | Closed range read only; frozen mappings; tax/import reconciliation gate |
| Security/UX | Role plus complete site scope; actionable preflight; repeat-download integrity |

## Testing Plan and Acceptance

### Backend E2E / serializer

- [ ] EX-01: two entities in one tenant export separately; wrong tenant returns 404; non-admin denied; admin missing one contributing site membership receives no partial run or leaked total.
- [ ] EX-02: inclusive range/end exactly at lock works; open/null-lock/cross-fiscal-year/reversed range fails. Credits dated later than original appear only in their own period.
- [ ] EX-03: FINALIZED/ISSUED/PAID invoices and FINALIZED credits included; drafts/void excluded; zero remaining balance never removes original booking.
- [ ] EX-04: seller/group/account edits and group deletion after issuance do not change frozen bookings. Unmapped/legacy/CANCELLED/AT/margin candidates block the initial profile with clear reasons.
- [ ] EX-05: approved accountant fixture imports successfully into the specified DATEV target; importer net/tax/gross/account totals equal the frozen ACP facts for mixed rates, discounts, full/partial credits and last-cent allocation.
- [ ] EX-06: full official column order/count, semicolon quoting, decimal comma, CRLF, chosen encoding, lengths and invalid characters tested; no silent truncation or additional tax booking.
- [ ] EX-07: same-key replay and repeated download are byte-identical with matching SHA-256 after profile edits; changed-key payload conflict and overlap acknowledgement behave as specified.
- [ ] EX-08: failed serialization/audit/database write leaves no completed artifact; empty and oversized periods return specified errors.
- [ ] EX-09: revocation/deactivation/profile change racing generation or download cannot leak a file; stale preview requires a new preview. Missing historic ownership blocks without guessed seller scope.
- [ ] EX-10: changing invoice status to PAID adds no payment row. Export creates no fiscal/stock mutations and no new invoice number.

### Frontend

- [ ] Browser flow: configure, preview, see blocker, resolve supported setting, re-preview, generate/download, compare checksum, inspect run history.
- [ ] Non-admin navigation hidden and direct API denied; overlap warning, empty period and autosave failure states are accessible and actionable.
- [ ] Visual QA confirms table/action placement and long blocker messages; downloading a failed response does not save JSON as a `.csv` file.

## Open Questions / Approval Record

The following decisions answer the PR review and define the revised baseline. Draft status remains until final product acceptance; accountant sign-off is not inferred from the review.

| Decision | Selected answer / gate |
|---|---|
| M1 mapping prerequisite | Keep strict coupling: M1 cannot ship without accountant-approved mapping fixtures. Profile configuration and immutable allocations ship in M1; export activation stays in M4. |
| M4 completion scope | DE/EUR domestic STANDARD export first. M4 can complete for this profile once its acceptance checks pass; AT and margin posting profiles are follow-ons, not conditions for that milestone. Any selected period containing them still blocks as a whole. |
| Historic site access | Require complete active-site membership coverage. Inactive contributing sites block slice-1 export; historic-access policy is a separate follow-on, not an implicit administrator bypass. |
| DATEV target and postings | Retain proposed EXTF 700/Buchungsstapel 13, collective debtor, explicit-BU or automatic-tax mapping, and unfixed batch flag. Accountant approval and the official schema/import fixture remain mandatory before enabling the profile. |
| Tracking | AUT-307 owns backend export; AUT-305 owns UI/audit. Duplicate cleanup is complete; no parallel backend issue remains in the delivery baseline. |

Accountant release evidence must identify the reviewer/date, official schema revision, target importer/version, approved account/BU/debtor settings and a successful import with matching net/tax/gross totals. Until that evidence exists, `is_enabled=false`; no claim of compatibility or sign-off is made by this documentation revision.

### Milestone 0 handoff

- [ ] Product owner accepts ADR-0023 and both feature specs; record decisions above.
- [ ] Documents merged and status changed to accepted/approved with decision date.
- [ ] Update Linear project's Next section to: “AUT-296 approved: ADR-0023 and legal-invoicing/datev-accounting-export specs are the implementation baseline. Begin milestone 1 (AUT-297–299), including its accountant-approved mapping prerequisite, then milestones 2 → 3 → 4. AUT-307 + AUT-305 own milestone 4. AUT-306 remains parked; country/DATEV activation gates still apply.” Add merged repository links at that time.
- [ ] Complete AUT-296 and verify Milestone 0 completion in Linear only after acceptance/merge. No completion is implied by this draft.

## References

- [[legal-invoicing-and-credit-notes]]; [[2026-09-20-legal-invoicing-and-accounting-export]]; [[2026-04-12-fiscal-lock-date]]; [[2026-04-12-invoice-snapshotting]]; [[2026-08-31-site-operational-scope]].
- [Official DATEV format portal](https://developer.datev.de/portal/de/dtvf), inaccessible during 2026-09-20 review; exact format conformance remains unverified and gated.
- Source: `apps/core-api/prisma/schema.prisma` (`RevenueGroup.account_number`, `InvoiceItem.revenue_group_name`, `FinanceSettings`); `apps/core-api/src/invoices/invoice-snapshot.ts`; `apps/core-api/src/finance/finance.controller.ts`; `apps/core-web/src/pages/SettingsPage.tsx`.

## Linear Tracking

| Field | Value |
|---|---|
| Project | [Legal Invoicing & Accounting Export](https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695) |
| Milestone | 0 review gate; delivery 4 — Accounting export (DATEV) |
| Issues | [AUT-296](https://linear.app/auto-core-platform/issue/AUT-296), [AUT-307](https://linear.app/auto-core-platform/issue/AUT-307), [AUT-305](https://linear.app/auto-core-platform/issue/AUT-305) |
