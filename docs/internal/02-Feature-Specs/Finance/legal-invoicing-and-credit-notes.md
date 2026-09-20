---
title: "Legal Invoicing and Credit Notes"
date: "2026-09-20"
module: "Finance / Sales / Workshop / Vehicle Stock / Site"
status: approved
linear-project: "https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695"
linear-milestone: "0 — Spec & ADR; delivery milestones 1–3"
tags: [feature-spec, finance, sales, invoice]
---

# Legal Invoicing and Credit Notes

## Summary

Extend each legal entity with seller identity, freeze complete legal and accounting facts when sales/workshop/vehicle invoices are committed, render Rechnung content through the existing PDF pipeline, and allow separately numbered commercial credits. This is the approved implementation baseline for AUT-296; [[2026-09-20-legal-invoicing-and-accounting-export|ADR-0023]] defines the architectural decisions. The separate [[datev-accounting-export]] spec owns period export.

### Scope and delivery boundaries

| Milestone | Must deliver | Issues |
|---|---|---|
| 1 — Seller identity & snapshot | LegalEntity settings, source/site ownership, snapshot v2 on all issuance paths, completeness/fiscal guards, accounting-profile configuration and frozen export mappings; cannot ship without accountant-approved mapping fixtures | AUT-297, AUT-298, AUT-299 |
| 2 — DACH Rechnung PDF | Seller/recipient/supply/payment content, tax breakdown, country/tax-mode fixtures | AUT-300, AUT-301 |
| 3 — Credit notes / Storno | Credit aggregate and series; full/quantity-partial credits; UI/PDF; concurrency bounds | AUT-302, AUT-303 |

Initial countries: **AT and DE**, matching the existing `LegalEntityCountry` enum. Initial ordinary invoices: domestic STANDARD VAT in EUR. Retain the existing vehicle MARGIN_SCHEME calculation, with country-specific document validation and no separate customer-facing VAT disclosure. Country margin fixtures require accountant approval before activation. CH is an explicit follow-on, not implicit “DACH compliance”.

Out of scope: structured e-invoices (AUT-306), CH/CHF/QR bills, reverse-charge/intra-community/exempt/small-business tax profiles, customer self-billing, advances, AR cash drawer, card settlement, partial payments, refunds, free-form credits, arbitrary amount rebates, credit-of-credit, stock returns and intercompany transfers. Do not silently represent these transactions as ordinary VAT invoices.

## User Stories

- As an OWNER/ADMIN, I maintain seller identity per legal entity so all its sites use the correct company.
- As an authorized invoice operator, I see what is missing before finalization and can correct the draft without consuming a number.
- As a customer, I receive the original agreed seller, items, tax treatment and payment terms, even after the workshop changes its master data.
- As an OWNER/ADMIN with site access, I issue a full or supported partial correction without changing the original invoice or stock.
- As an accountant, I can reconcile invoice/credit amounts and later export their original accounting allocations.

### Journeys

1. **Configure seller:** Settings → Legal entities → entity detail. Autosave incomplete settings; show readiness and missing fields. Activate issuance only after the selected country profile validates. Country remains immutable.
2. **Issue invoice:** open an eligible source in its authorized site → draft invoice → review recipient, supply date and totals → Finalize/Issue. Reject missing fields with specific errors; successful commit freezes the snapshot and number. PDF retries use that snapshot.
3. **Correct invoice:** invoice detail → top-right `+ Credit Note` → choose Full or line quantities, enter reason and date → autosaved draft → review original/new totals and “No stock return or refund” explanation → Finalize. Show linked original and remaining creditable quantities. A stale draft that exceeds the remaining balance fails without a number.
4. **Old document:** view its archived PDF or original version-1 snapshot. Do not enrich it using today's identity. If evidence is missing, show an actionable historical-document error rather than an invented legal invoice.

### Operational handling of mistaken credits

OWNER/ADMIN with the original site's access can VOID only DRAFT credits. Once a CN is finalized, support records the original/CN identifiers and mistake in a support case and escalates to the responsible accountant for external corrective-document handling and reconciliation. Preserve the CN, its number, snapshot and export entries; no database edits, second credit to undo the first, source-order reopening or automatic refund. ACP continues to show the recorded credit until a separately approved corrective debit workflow exists; an external correction does not silently change ACP balances. Product-owner acceptance of this limitation is required before milestone 3 activation, in addition to the finalization confirmation UI.

## Database Impact

### New Tables / Columns

All names below are proposed persisted names. New tables carry UUID `id`, `tenant_id`, `createdAt`, `updatedAt` unless explicitly immutable counters. Tenant scoping applies to every lookup and nested relation.

| Table | Column | Type | Nullable | Notes |
|---|---|---|---|---|
| `legal_entities` | `address_street`, `address_line2`, `address_zip`, `address_city` | String | Yes | Required at issuance except line2; seller country remains `country_iso`. |
| `legal_entities` | `tax_number`, `vat_id` | String | Yes | Country readiness rules below; never populate guessed defaults. |
| `legal_entities` | `iban`, `bic`, `bank_name` | String | Yes | Normalize/validate supplied values; no mandatory bank account. |
| `legal_entities` | `email`, `phone`, `registration_number`, `registration_court`, `representatives` | String | Yes | Contact/corporate footer; legal-form requirements reviewed in country fixtures. |
| `legal_entities` | `payment_terms_days`, `payment_terms_text` | Int / String | Yes | Days 0–365; plain text, max 1000 characters; required on issuance. |
| `invoices` | `site_id`, `legal_entity_id` | UUID FK | Historical only | Required for new drafts/commits; composite tenant/site/entity consistency. |
| `invoices` | `supply_date_from`, `supply_date_to` | Date | Historical only | One date uses same from/to; from ≤ to; supplied explicitly by draft operator. |
| `invoices` | `currency` | String | Historical only | New v2 fixed `EUR`; do not relabel historic currencies. |
| `invoice_items` | `accounting_snapshot` | JSON | Historical only | Frozen account allocation from the per-entity profile in export spec. |
| `credit_notes` | `original_invoice_id`, `site_id`, `legal_entity_id` | UUID FK | No | Must match original tenant/site/entity. |
| `credit_notes` | `status`, `credit_number`, `date`, `reason`, `version` | Enum / String / Date / String / Int | Number until final | DRAFT/FINALIZED/VOID; reason 1–1000 chars; optimistic version on draft saves. |
| `credit_notes` | `total_net`, `total_tax`, `total_gross`, `snapshot` | Decimal(10,2) / JSON | Snapshot until final | Positive values; explicit credit document kind supplies polarity. |
| `credit_notes` | `idempotency_key`, `request_hash`, `finalized_at` | String / String / DateTime | Until final | Durable same-command retry semantics; unique `(tenant_id, idempotency_key)`. |
| `credit_notes` | PDF storage/status fields | Same types as Invoice | Yes | Reuse existing storage/generation conventions. |
| `credit_note_items` | `credit_note_id`, `original_invoice_item_id`, `quantity`, `snapshot` | UUID FKs / Decimal(10,3) / JSON | No | Stable original IDs, copied amounts/accounting, unique original line per credit. |
| `credit_note_sequences` | `year`, `current` | Int | No | Unique tenant/year; atomic counter; independent of existing RE series. |

Add unique `(tenant_id,id)` to new referenced parents and Invoice; enforce credit-to-original tuple and line-to-original-invoice ownership with composite keys/FKs. Index invoices and credits by `(tenant_id,site_id,date)` and `(tenant_id,legal_entity_id,date)`; unique `(tenant_id,credit_number)`. New FK relations use Restrict for financial parents. Credit item rows copy tenant/site ownership or enforce it through a composite parent FK; no tenant-only include on a site-owned parent.

### Modified Tables and migration

| Table | Change | Migration Required? |
|---|---|---|
| LegalEntity | Add nullable seller fields; preserve AT/DE and immutable country | Yes, additive |
| Invoice / InvoiceItem | Ownership, supply dates, currency and accounting snapshot; v2 JSON | Yes, additive; no historical financial backfill |
| Site / Invoice | Composite keys for persisted seller/site consistency | Yes |
| Tenant / Invoice | Reverse relations for credit aggregates | Yes |
| InvoiceSequence / FinanceSettings | No series reset, no extra invoice counter, tenant fiscal lock retained | No new counter here |

Migration reports separately: resolvable one-source ownership, conflicting sources, missing source/site, source-less invoice, missing snapshot and missing accounting evidence. Backfill only provable technical ownership. Preserve original financial JSON/PDF bytes. New source-less invoice finalization is rejected; current `POST /api/sales/invoices` needs an eligible source reference for v2. This intentionally closes drift from ADR-0004 and must be reflected in frontend creation flows and tests.

### Deletion Policy Impact

The additions documented under **ADR-0023 — Legal invoicing and accounting export** in `docs/deletion-policy.md` are the accepted policy baseline: credits are voided while draft and never hard-deleted; credit lines follow their draft parent; finalized lines/sequences/export artifacts cannot be deleted through ordinary APIs; LegalEntity cannot be deleted when financial records reference it. These become API-enforced rules when implementation ships. Do not present them as already enforced.

## Snapshot and Financial Contract

Version 2 retains existing customer/vehicle fields and adds:

| Field | Required content |
|---|---|
| `schema_version`, `document_kind`, `template_version`, `country_profile_version` | `2`; INVOICE or CREDIT_NOTE; pinned renderer/profile identifiers |
| `site_id`, `legal_entity_id`, `currency` | Persisted ownership, EUR |
| `seller` | LegalEntity name/country, complete address, tax IDs, bank/contact/corporate footer fields exactly as issued |
| `date`, `due_date`, `supply_date_from`, `supply_date_to` | ISO date-only fiscal/supply dates; due date derived from date + snapshotted days |
| `payment_terms` | `days`, `text`; for credits this is original context, not an instruction to pay again |
| `items[]` | Stable original item ID, description, quantity (3 decimals), price/discounts, allocated `net`, `tax`, `gross` (2 decimals), rate, group label, accounting allocation |
| `tax_breakdown[]` | STANDARD: rate, net, tax, gross; stored sums must equal document totals |
| `margin` | MARGIN_SCHEME only: frozen cost basis, margin tax and calculation/profile metadata; internal finance data, never customer-facing cost/VAT disclosure |
| `original_document` | Credit only: original UUID, number, date, reason, original snapshot version |
| `snapshot_created_at` | Commit timestamp |

Snapshot inclusion does not authorize disclosure: customer PDF/public serialization uses an allowlist that excludes internal accounting, cost basis and internal notes. Financial UI/API fields require existing financial permissions.

Money uses decimal arithmetic and EUR cents. For STANDARD, apply line discounts, allocate document discount proportionally to pre-document-discount line net amounts, floor allocations to cents and distribute remaining cents by descending fractional remainder, tie-breaking stable item ID. Compute each allocated line tax to cents with half-up rounding, then sum line net/tax/gross into rate buckets and totals. Reject inconsistent stored totals rather than patching cents at export time. Three-decimal quantities must not be rounded down to the current snapshot builder's two decimals.

For a partial credit, allocate original net/tax amounts proportionally to credited quantity with the same rounding convention. Cap cumulative money and quantity; the final remaining quantity receives the exact outstanding cents. Full margin credits reverse the saved margin allocation exactly; never recalculate from today's vehicle ledger or tax rate.

### Validation and state transitions

- DE STANDARD readiness: full seller name/address, DE tax number or VAT ID, full customer name/address, explicit supply date/period, payment terms, supported tax/account mapping. AT uses seller UID; AT business recipients above EUR 10,000 gross also require customer UID. These are the selected standard-invoice profile; bank details remain optional. [DE §14 UStG](https://www.gesetze-im-internet.de/ustg_1980/__14.html), [AT official invoice guidance](https://www.usp.gv.at/themen/steuern-finanzen/umsatzsteuer-ueberblick/rechnung.html).
- Settings saves permit missing fields but reject malformed supplied values. Empty optional strings normalize to null; names/address trim whitespace, postal codes remain strings. IBAN uses country length/checksum, BIC syntax, email syntax, tax IDs country syntax; no claim of live tax registration verification.
- Sales `DRAFT → FINALIZED`, workshop invoice `DRAFT → ISSUED`, and vehicle-sale-created `FINALIZED` all count as the legal commit and receive v2 atomically. Existing source transitions remain guarded. No new generic invoice status.
- Credit eligibility: original version-2 FINALIZED/ISSUED/PAID; same tenant/site/entity; quantity > 0 and ≤ remaining; nonempty reason; date ≥ original date and > lock date. Full credit after partials means all remaining quantities, not the original gross a second time.
- On original locked periods, a new credit uses the open-period date and leaves the original unchanged. A lock advance racing issuance must serialize with the same finance-settings row lock.
- Missing/invalid active site → 422 `ACTIVE_SITE_REQUIRED`; wrong tenant/site document → 404; role denial → 403; malformed payload → 400; stale version, idempotency mismatch or exceeded remaining credit → 409; locked fiscal date or incomplete/unsupported legal profile → 422.
- Business error codes include `SELLER_IDENTITY_INCOMPLETE` with `missingFields`, `CUSTOMER_IDENTITY_INCOMPLETE`, `SOURCE_DOCUMENT_REQUIRED`, `ACCOUNTING_MAPPING_INCOMPLETE`, `FISCAL_PERIOD_LOCKED`, `UNSUPPORTED_TAX_PROFILE`, `LEGACY_DOCUMENT_UNSUPPORTED`, `CREDIT_LIMIT_EXCEEDED`. Do not disclose foreign document existence in diagnostics.

## API Contract Changes

Routes below are proposed; existing routes keep their spelling. Dates are `YYYY-MM-DD`, decimals strings and UUIDs server validated. All commands revalidate tenant/site scope; client ownership IDs are never authority.

### New Endpoints

| Method | Route | Request Body | Response | Auth |
|---|---|---|---|---|
| POST | `/api/invoices/:id/credit-notes` | `{date,reason,mode:"FULL"}` or `{date,reason,mode:"PARTIAL",lines:[{originalItemId,quantity}]}`; FULL expands remaining lines server-side; PARTIAL requires nonempty distinct lines | Draft credit with remaining balances/version | OWNER/ADMIN + original site membership |
| GET | `/api/credit-notes` | Query page, limit, search, sort | `{data,meta}` scoped to active site | OWNER/ADMIN + site membership |
| GET | `/api/credit-notes/:id` | — | Credit detail and original reference | Same |
| PATCH | `/api/credit-notes/:id` | `{expectedVersion,date?,reason?,lines?}`; present lines replace draft set | Updated draft/version | Same |
| POST | `/api/credit-notes/:id/finalize` | `{expectedVersion,idempotencyKey}` | Immutable numbered credit; replay returns same result | Same |
| POST | `/api/credit-notes/:id/void` | `{expectedVersion}` | VOID unnumbered draft | Same |
| POST / GET | `/api/credit-notes/:id/pdf` | Existing PDF request pattern / none | Existing async status / PDF binary | Same |

Credit PDF work plugs into the existing authenticated task, retry, storage and download infrastructure using the appropriate credit document lookup. It adds document support; it does not replace queue/worker transport or change Invoice worker URLs.

### Modified Endpoints

| Method | Route | Change Description |
|---|---|---|
| GET / POST / PATCH | `/api/legal-entities` / `/api/legal-entities/:id` | Seller fields/readiness; preserve OWNER/ADMIN and existing list shape |
| POST / PATCH | `/api/sales/invoices` / `/api/sales/invoices/:id` | Eligible sales source on create, persisted ownership, supply dates and payment preview; source immutable after binding |
| PUT | `/api/sales/invoices/:id/finalize` | Transactional snapshot v2, completeness and ownership guards |
| POST / PATCH | `/api/invoices/drafts` / `/api/invoices/:id/issue` | Same v2 rules on workshop path |
| Existing vehicle-sale invoice action | Existing vehicle-sale route | Same seller/site guard and versioned margin snapshot; preserve route |
| GET | Existing invoice list/detail/PDF routes | Site isolation, snapshot version, linked credits/remaining quantities, historical handling |

### OpenAPI Regeneration

Required during implementation, not this Markdown-only change:

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`
- [ ] Commit both generated artifacts; frontend consumes generated contracts.

## UX Compliance

- [ ] Settings stays in `SettingsPage` / `LegalEntitiesSettingsTab`; full legal name and country are clearly distinct from the site's label.
- [ ] Page actions top-right; title/context/badges top-left; standard `text-2xl font-semibold tracking-tight` and `text-slate-500` typography.
- [ ] Credit lists use DataTable, global visible-field search, sortable headers, shared StatusBadge and row-click detail. No Delete action; use explicit Void for drafts.
- [ ] `+ Credit Note` follows entity-only creation labels. No cash/refund promise on commercial credit UI.
- [ ] Multi-field seller/credit forms autosave at 750 ms with persistent Saving/Saved/Error; await pending saves before finalize. Single isolated edits use InlineEdit on blur.
- [ ] New DRAFT/FINALIZED/VOID mappings use shared StatusBadge. “Partially/Fully credited” is a derived indicator separate from invoice payment status.
- [ ] PDF titles are Rechnung / Stornorechnung / Rechnungskorrektur; every credit identifies original number/date. Do not call a supplier correction a self-billing Gutschrift.
- [ ] PDF shows seller, recipient, number, issue date, supply dates, descriptions, quantity, discounts, payable total and terms; STANDARD adds rate buckets. Margin PDF omits internal cost and separately stated VAT and uses the approved country note.
- [ ] Long addresses/notes, page breaks, repeated table headers and totals/footer placement are visually checked with multi-page fixtures.

### Real-Time Sync

Register CreditNote mutations in the Prisma realtime extension and frontend entity map; send only to the persisted site room. Invalidate credit detail/list and original invoice remaining-credit queries using domain key factories. Seller/profile settings events must not broadcast bank/tax data to tenant-wide unauthorized clients; use authorized settings invalidation or refetch, not full row payloads. PDF completion reuses existing status/refetch behavior. Snapshot immutability also applies after realtime refresh.

## Component Design

| Component | Location | Purpose |
|---|---|---|
| LegalEntitiesSettingsTab (modify) | `apps/core-web/src/components/settings/LegalEntitiesSettingsTab.tsx` | Seller form and readiness |
| InvoiceDetailPage (modify) | `apps/core-web/src/pages/sales/InvoiceDetailPage.tsx` | Frozen seller/tax facts, credit entry and related documents |
| CreditNoteDetailPage / CreditNotesPage (new) | `apps/core-web/src/pages/finance/` | Draft/final views and standard list |
| Credit API hooks (new) | `apps/core-web/src/api/useCreditNotes.ts` | Generated types and shared `creditNoteKeys` factory |
| Snapshot and renderer (modify) | `apps/core-api/src/invoices/invoice-snapshot.ts`, `invoice-snapshot.resolver.ts`, `invoice-pdf.renderer.ts`, `invoice-pdf.layout.ts` | Version dispatch and immutable presentation |
| Credit service/controller (new) | `apps/core-api/src/credit-notes/` | Commercial aggregate only; no inventory mutation |

## Impact Analysis

| Dimension | Required treatment |
|---|---|
| Database | Additive fields/new credit tables, safe ownership backfill and exception report |
| State machines | Preserve invoice/source states; guarded draft credit finalization/void; derived coverage |
| Deletion | Proposed policy additions; no finalized deletion or status-only reversal |
| Realtime | Site-room credit invalidation; sensitive settings payloads excluded |
| API | New credit endpoints and expanded DTOs; generated contract update |
| Inventory | Existing issuance effects remain atomic; credits have zero stock/vehicle-ledger effects |
| Finance | Tenant lock serialized with commit; separate CN counter; exact rounding and frozen accounts |
| UX | Settings autosave, actionable readiness errors, explicit finalization confirmation |

## Testing Plan and Acceptance

### Backend E2E

- [ ] LI-01: AT/DE owner can save incomplete seller settings; malformed supplied IDs/bank/email rejected; ordinary member denied; other tenant entity returns 404.
- [ ] LI-02: sales, workshop and vehicle commit paths all snapshot the correct source seller; switching sites cannot relabel/issue another site's draft.
- [ ] LI-03: missing seller/recipient/supply/accounting data rolls back number, source status and stock writes. An approved complete mapping permits v2 issuance while DATEV export is disabled; absent/unapproved mapping fixtures prevent M1 release. Source-less draft finalization fails explicitly.
- [ ] LI-04: change seller, customer, revenue group/account, payment terms and vehicle cost after issuance; saved snapshot/PDF financial content remains unchanged.
- [ ] LI-05: quantity 0.125 remains 0.125; multi-rate/line/global discounts sum exactly; margin fixtures disclose no customer-facing cost or VAT.
- [ ] LI-06: legacy archived PDF unchanged; version-1 render contains no invented seller; missing historical evidence returns documented error without snapshot write.
- [ ] LI-07: simultaneous RE and CN issuance remains unique; rollback uses no number; retry of one credit finalization returns same CN; changed key payload returns 409; year rollover has independent series.
- [ ] LI-08: two credits racing to consume the same remaining quantity cannot over-credit; last fractional credit reverses remaining cents exactly; stale draft is rejected.
- [ ] LI-09: locked original + current open-period credit succeeds; credit date on lock boundary fails; lock advance/deactivation racing finalization has only valid serialized outcomes.
- [ ] LI-10: draft original, legacy original, zero/negative/excess quantities, foreign lines, partial margin credit and already fully credited original are rejected. PAID original is eligible with no refund effect.
- [ ] LI-11: issuing a credit leaves inventory/vehicle ledger, reservation, source status and original snapshot unchanged; authorized OWNER/ADMIN can VOID only drafts without a number; finalized credit mutation/delete fails and UI directs mistaken-CN cases to support/accountant escalation.
- [ ] LI-12: PDF enqueue/download and nested original/credit relations cannot leak across tenant or site boundaries.

### Frontend / PDF

- [ ] Visual QA for AT/DE standard, supported margin, full/partial credit and multi-page invoices; seller/contact/bank changes do not affect an old render.
- [ ] Autosave failure prevents finalize; readiness error links to authorized Settings; non-admin receives explanatory guidance without settings access.
- [ ] Browser flow creates draft credit, survives concurrent credit changes, finalizes and downloads PDF; status/remainder refresh across tabs only in authorized site.

Use existing unit/E2E infrastructure with fresh unseeded backend DB and serial E2E; required repo CI checks apply when implemented. This documentation task runs link/structure/diff verification only.

## Open Questions / Approval Record

The 2026-09-20 PR review approved the architectural direction and requested explicit decisions. The following answers define this revision's baseline.

**Product owner acceptance:** 2026-09-20 — Dejan Dosenovic (Product Owner) accepted this spec and [[2026-09-20-legal-invoicing-and-accounting-export|ADR-0023]] as the AUT-296 Milestone 0 implementation baseline.

| Decision | Selected answer / consequence |
|---|---|
| Country/currency | AT/DE EUR first. CH and special tax regimes remain deferred; country-specific margin document fixtures gate activation. |
| Credits | Full credits and quantity-only STANDARD partial credits. No correction of finalized credits in slice 1; accept the support/accountant escalation risk described above as part of final product approval. |
| Source ownership | Close source-less v2 issuance. Ambiguous historical ownership requires audited manual remediation; no switcher-based inference. |
| Number series | Preserve tenant-wide RE and add tenant-wide CN across legal entities. No per-entity reset/migration in this slice; accountant confirms the rollout fixture. |
| M1 accounting coupling | **Keep required mappings. M1 cannot ship without accountant-approved mapping fixtures.** No nullable accounting escape hatch for new v2 invoices. Missing mappings block issuance with `ACCOUNTING_MAPPING_INCOMPLETE`; DATEV `is_enabled` gates only export. |

Still required before M1/M4 activation: accountant review of corporate-footer obligations, domestic/margin document fixtures, mapping fixtures and series usage for enabled profiles. Record reviewer/date/evidence when obtained; none is claimed here. Implementation plans follow this accepted baseline.

## References

- [[2026-09-20-legal-invoicing-and-accounting-export]]; [[datev-accounting-export]]; [[2026-04-12-invoice-snapshotting]]; [[2026-04-12-fiscal-lock-date]]; [[2026-04-12-sequential-document-numbering]]; [[2026-08-31-site-operational-scope]]; [[2026-04-12-async-pdf-pipeline]].
- [German invoice requirements, UStG §14](https://www.gesetze-im-internet.de/ustg_1980/__14.html), official search excerpt checked 2026-09-20; full-page fetch timed out. Detailed country fixtures still need review.
- [Austrian BMF/USP invoice guidance](https://www.usp.gv.at/themen/steuern-finanzen/umsatzsteuer-ueberblick/rechnung.html), checked 2026-09-20 (page updated 2026-01-01).
- [German BMF e-invoice FAQ](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html), checked 2026-09-20: PDF delivery is not structured e-invoicing; transitional eligibility must be evaluated before launch. Deferring AUT-306 is not a claim of universal DE B2B readiness.

## Linear Tracking

| Field | Value |
|---|---|
| Project | [Legal Invoicing & Accounting Export](https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695) |
| Milestone | 0 review gate; implementation 1 → 2 → 3 |
| Issues | [AUT-296](https://linear.app/auto-core-platform/issue/AUT-296), AUT-297–303; AUT-306 deferred |
