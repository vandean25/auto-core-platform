---
title: "ADR-0023: Legal Invoice Snapshots, Credit Notes and Accounting Export"
date: "2026-09-20"
status: accepted
deciders: "Product Owner (Dejan Dosenovic, 2026-09-20); accountant review required for country and DATEV profiles"
linear-project: "https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695"
linear-milestone: "0 — Spec & ADR"
tags: [adr, finance, sales, invoice]
---

# ADR-0023: Legal Invoice Snapshots, Credit Notes and Accounting Export

## Status

**Accepted — 2026-09-20 (Product Owner).** ADR-0023 is the implementation baseline for AUT-296. ADR-0003, ADR-0004, ADR-0009 and ADR-0022 remain accepted. This ADR extends their snapshot/numbering rules and replaces status-only cancellation for newly issued version-2 invoices. It does not retroactively change historical documents.

Accountant-approved mapping fixtures remain a **M1 release gate**; official DATEV schema/import evidence remains a **M4 export activation gate**. Those gates do not block marking this ADR and the linked feature specs accepted.

## Context

The Legal Invoicing & Accounting Export project needs seller identity, customer-facing Rechnung content, financial corrections and an accountant export. These cross Finance, Sales, Workshop, Vehicle Stock and Site; ship them in the project's ordered milestones.

Repository inspection on 2026-09-20 found:

| Current implementation | Consequence |
|---|---|
| `LegalEntity` has name, immutable AT/DE country and activity; a site belongs to one immutable legal entity. | Extend this record, not `Tenant`; CH is not currently supported. |
| `Invoice` has three optional source links but no persisted site or seller FK. | Ownership must be resolved from the source and persisted before new legal documents can be issued safely. |
| `SalesService.createDraft` permits source-less invoices, despite ADR-0004 describing source-backed creation. | Close this gap for new version-2 issuance; do not infer an old document's seller from the current switcher. |
| Sales finalization returns an invoice without constructing its snapshot there; workshop issue builds a snapshot at `ISSUED`; vehicle sale builds one at `FINALIZED`. | All three commit paths need the same immutable snapshot contract. `ISSUED` is also legally committed. |
| `resolveInvoiceSnapshot` can reconstruct and persist a missing snapshot from live customer/vehicle data. | This fallback must not fabricate historical seller or financial facts. |
| `InvoiceItem` has `revenue_group_name`, but no frozen account number or net/tax/gross allocation. | Export cannot safely look up today's revenue group by its old name. |
| `InvoiceSequence` is unique by tenant/year; sales uses `RE-{calendar year}-{counter}`. | Preserve existing RE numbers and counters; avoid an unnecessary series migration. |
| ADR-0004 describes full cancellation; inspected invoice controllers expose no dedicated cancellation command. | Treat cancellation as documented legacy behavior, not a verified reusable API. |

## Decision Drivers

- Finalized documents must survive master-data changes unchanged.
- Legal seller and operational access are separate: legal entity owns identity; site owns access.
- Corrections must remain auditable without reopening locked periods or restocking goods implicitly.
- An export must reconcile to committed documents and must never silently omit unsupported records.
- Reuse the existing PDF pipeline and tenant transaction patterns; introduce no accounting ledger or payment engine.

## Decision

### 1. Extend LegalEntity; initially support AT and DE

Retain `name` as the full legal seller name and immutable `country_iso`. Add nullable address, tax identifiers, bank details, contact details and payment defaults specified in [[legal-invoicing-and-credit-notes]]. Nullable storage allows existing entities and incomplete settings to migrate; issuing a new invoice requires a complete supported country profile. No fabricated migration defaults.

Require postal address and country-appropriate tax identity at issuance. DE standard VAT requires Steuernummer or USt-IdNr; AT standard VAT requires UID. IBAN/BIC are optional, validated when present, and must not be described as universal statutory invoice requirements. Require explicit payment terms and supply date/period as product rules. Full recipient details are required even when a small-invoice exception could apply. Tax-exempt, reverse-charge, intra-community and CH profiles are deferred; do not infer them from zero tax or country alone.

Domestic standard VAT is the first production profile. Preserve existing vehicle `MARGIN_SCHEME` with a distinct snapshot and renderer policy; activate each country-specific margin profile only after the accountant approves its wording and fixtures. A PDF is not a structured e-invoice. AUT-306 remains separate, with a launch eligibility check for customers subject to mandatory structured invoicing.

### 2. Persist ownership and snapshot at the committing transaction

For new invoices, persist `site_id` and `legal_entity_id`, resolving exactly one source document inside the tenant and authorized site. They must agree with `Site.legal_entity_id`. Use tenant-safe and site-safe composite FKs and indexes. The source's persisted site is authoritative; the active site grants access, not ownership. New source-less issuance is rejected. Existing source-less drafts require recreation from an eligible source; do not guess a site.

The same transaction must validate live permissions, active site/entity, fiscal date, source state, seller/customer completeness and accounting mapping; freeze all version-2 fields; assign the number; commit invoice/source states and existing inventory effects. Site/entity/settings updates and issuance must serialize so the validations cannot race a deactivation or fiscal-lock advance. Use the same documented lock order across affected writers: legal entity, site, tenant finance settings, source, invoice, sequence. Credit commands also serialize on the original invoice before allocating a credit number. Revalidate after locks; no live query inside a line loop.

Version 2 contains seller and customer identities, ownership IDs, document kind, dates, EUR currency, payment terms, supply date/period, stable line IDs, quantity at three decimals, unit price/discounts, per-line final net/tax/gross, revenue-group label and accounting allocation, tax buckets, total amounts and template/profile versions. See the feature spec for the exact field contract. Monetary values are decimal strings. A deterministic cent allocation makes line/bucket/document totals identical after discounts. Margin data is stored separately and never rendered as separately deductible VAT.

Customer PDF content reads only its snapshot. Export reads only frozen document/accounting facts plus the frozen export profile for that run. Customer/profile changes after commitment do not change historical documents.

### 3. Preserve history and fail explicitly on insufficient evidence

Do not backfill seller addresses, bank accounts, tax IDs, accounts or amounts into committed invoices. Existing snapshots are version 1 when no version is present. Serve archived PDFs unchanged. Version-1 snapshots remain renderable as historical documents without adding a live seller block. If both snapshot and archived PDF are absent, return `409 LEGACY_SNAPSHOT_UNAVAILABLE`; manual remediation is separate, audited work.

Technical ownership FKs may be backfilled only from exactly one consistent tenant-safe source/site, with an audit report; this does not certify historic seller details. Ambiguous/source-less records retain nullable ownership and remain outside the new site-scoped export/credit flow. They need an explicit migration exception report, not guessed access or a tenant-wide visibility fallback. New drafts must have ownership; migrated drafts without it cannot finalize.

Export and credit-note issuance require version-2 evidence. A selected period with legacy or unsupported documents is blocked with authorized document IDs and reasons; never emit an apparently complete partial file. Legacy cancellation cannot be reconstructed as a dated credit note from status alone.

### 4. Separate CreditNote aggregate; commercial corrections only

Use `CreditNote` + `CreditNoteItem`, referencing one original `Invoice` and its immutable line IDs. Keeping a separate aggregate preserves the existing one-invoice-per-source unique constraints and avoids accidentally sending a credit through stock-deduction logic.

Lifecycle: `DRAFT → FINALIZED`, or `DRAFT → VOID`. Only drafts are editable; VOID is terminal and unnumbered. Issued credits cannot be edited, deleted or cancelled. A mistaken finalized credit requires a later corrective debit workflow outside this slice; the UI must preview and confirm finalization. No credit-of-credit support.

**Operational consequence:** Only OWNER/ADMIN with access to the original site may VOID a DRAFT credit. For a mistaken finalized CN, support records the original/CN identifiers and error in a support case, preserves all snapshots and numbers, and escalates to the responsible accountant for an externally managed correction and reconciliation. Support must not edit the database, issue another credit to undo it, reopen the source order or imply that ACP has repaired the balance. The existing CN remains in exports; any external corrective document must be reconciled by the accountant outside ACP. Corrective debit support is an explicit follow-on in the deferrals log. Acceptance of this ADR must explicitly accept that operational limitation before milestone 3 is enabled.

Slice 1 supports full credits and partial **quantity-based** credits for STANDARD invoices. Arbitrary price reductions, free-form credit lines and mixed originals are deferred. MARGIN_SCHEME permits full-document credit only, copying and reversing the original internal allocations. Credits carry positive stored amounts and explicit credit polarity; do not combine negative money with reversed debit/credit signs.

Copy original seller, customer, ownership, tax profile and accounting facts. Use a new credit date and reason, plus original number/date. Reject dates earlier than the original invoice or at/before the tenant lock date. An original in a closed period may be credited in a later open period; never mutate its fiscal fields/status. Credit coverage is derived from finalized credits, not a new invoice status. Original `PAID` does not prevent a commercial credit or create a cash refund.

Serialize on the original invoice and cap cumulative credited quantity and allocated money at each original line's remaining amount. Drafts do not reserve capacity. Pro-rate original allocated net/tax amounts using decimal arithmetic; the last credit consumes the remaining cents exactly. Durable idempotency on finalization returns the same document for a same-key/same-body retry; a changed body under that key returns 409. Retain the request hash/key on the finalized credit.

No credit changes inventory, reservations, workshop completion, dealer-stock state, vehicle cost basis or source-order eligibility. A physical return needs a separate authorized ledger workflow. Newly issued version-2 documents cannot use status-only cancellation to bypass this rule. Full reversal is a numbered credit with title **Stornorechnung**; partial reversal uses **Rechnungskorrektur**, avoiding DE's self-billing meaning of “Gutschrift”.

### 5. Preserve RE numbering; add a separate tenant/year credit series

Keep `InvoiceSequence` and RE numbering unchanged, shared across sites and entities in the tenant. Add `CreditNoteSequence`, unique `(tenant_id, year)`, with `CN-{YYYY}-{XXXX}`. Each series increments atomically in the document's finalization transaction; rollbacks consume no number and committed numbers are never reused. Use the existing calendar-year convention at assignment, not `fiscal_year_start_month`; tests fix the clock at rollover. Credit date and issuance timestamp are distinct.

This retains ADR-0009's integrity without renumbering history. A tenant-wide sequence may interleave multiple legal entities; numbers remain unique and each seller's history explains those interleavings. Per-entity series are deferred until specifically required, rather than resetting RE during this project.

### 6. DATEV export is a closed-period, legal-entity-scoped artifact

Choose a DATEV **EXTF Buchungsstapel CSV**, proposed profile `ACP-DATEV-DE-EUR-1` targeting EXTF 700 / Buchungsstapel 13. This is an explicit proposed target, not a verified compatibility claim: the official DATEV portal was inaccessible during drafting. AUT-307 must obtain the official versioned field specification and prove an import fixture before the profile is enabled. Exact positional columns/encoding/length limits follow that pinned specification, not a hand-built short CSV.

The first enabled export profile is DE/EUR domestic STANDARD VAT. AT and margin-scheme export require separately approved posting fixtures; until then a period containing those documents is blocked. A supported PDF does not imply a supported accounting export. The export spec records this deliberate release limitation and its review gate.

One run covers one legal entity and a closed date range within one fiscal year. OWNER/ADMIN is necessary but not sufficient: the named export authorization helper must verify active tenant membership and active site memberships for every site whose documents are included. No silently restricted “whole entity” export. Records from inactive sites require a separately reviewed historic-access policy; slice 1 fails clearly rather than widening authority.

Freeze per-entity DATEV profile metadata and every document's accounting allocation; never resolve by current revenue-group name at download time. Generate stable rows from invoice/credit line snapshots, positive gross values, opposite debit/credit polarity for credits, one approved tax mechanism per row. Include committed invoices regardless of FINALIZED/ISSUED/PAID delivery/payment status; include finalized credits at their own date even when their original is outside the period. Draft/VOID documents are not bookings. Legacy CANCELLED documents block the run unless a later audited migration supplies complete original and reversal facts.

Persist an immutable `AccountingExport` run with document manifest, frozen profile, SHA-256, exact file bytes and actor/time. Downloading again returns the same bytes and does not mark invoices paid or alter fiscal facts. Reauthorize on download. Duplicate import prevention remains with the accountant: clearly identify repeat/overlapping runs; ACP does not claim the file was imported.

Retain the bounded exact CSV bytes in Postgres in slice 1; long-term retention/offload requires a separate approved policy and must not become an ad-hoc TTL or cleanup job.

## Consequences

### Positive

- Seller, money and account mappings survive master-data edits and site switching.
- Commercial credits preserve fiscal and inventory audit trails.
- Existing PDF transport and invoice/source links remain reusable.
- Blocking unsupported export cases prevents silently incomplete period close.

### Negative

- Existing unlinked invoices need manual ownership remediation; legal identity cannot safely be reconstructed.
- Extra snapshot fields, credit tables and immutable export storage increase retention and migration work.
- The first export profile does not cover every document type/country already present; accountant fixtures are a real milestone gate.
- Incorrect finalized credits cannot be repaired by another credit in this slice.

### Neutral

- Invoice/source status values and tenant-wide fiscal lock remain unchanged.
- Bank details and payment terms are product/document data, not a payment integration.
- Purchase invoices, payments, intercompany transfers and general-ledger balancing are outside this export.

## Alternatives Considered

| Option | Benefit | Reason not selected |
|---|---|---|
| Seller fields on Tenant | One settings row | A tenant can contain several legal entities. |
| Resolve live seller/accounts while rendering | Fewer stored fields | Rewrites historical documents after settings changes. |
| Invoice subtype for credits | Reuses all invoice routes | Conflicts with source uniqueness and couples reversal to existing inventory paths. |
| Negative invoice/status cancellation | Small change | Loses correction identity, remaining-credit bounds and dated export evidence. |
| Per-entity RE series now | Each entity has a local sequence | Requires collision/migration policy without improving snapshot correctness. |
| Generic CSV or full accounting integration | Simpler CSV / broader functionality | Generic CSV is not DATEV; full ledger/payment integration exceeds slice 1. |

## Implementation Strategy

Milestone 1: additive identity/ownership/snapshot migration, accounting-profile configuration and frozen mappings on all issuance paths (AUT-297–299). **M1 cannot ship without accountant-approved mapping fixtures for each enabled invoice profile.** Keep this prerequisite even when the DATEV serializer is disabled; it prevents creating new documents without immutable export evidence. Milestone 2: snapshot-driven PDF content and tax fixtures (AUT-300–301). Milestone 3: credits, sequence, UI and PDF (AUT-302–303). Milestone 4: DATEV serializer/profile activation, export and audit (AUT-307, AUT-305).

The review revision selects AT/DE EUR invoicing, quantity-only STANDARD partial credits, manual historical ownership remediation and tenant-wide RE/CN series. M4 completion targets DE STANDARD export with whole-run blocking for AT/margin; complete active-site access remains required and inactive-site history is blocked. These are the concrete baseline decisions for acceptance, not claims of accountant sign-off. See both specs' decision records for release evidence and owners.

Expand nullable historical fields first, report unresolvable ownership, configure sellers, validate fixtures, then enable version-2 issuance. Keep legacy readers. Do not deploy a writer rollback that can issue old-format invoices after version 2 is enabled; disable issuance until a forward fix. Numbered documents and export artifacts survive feature rollback. Contract migrations must retain historical nullability where evidence is unavailable.

Blast radius is high: issuance, fiscal lock, site authorization, PDF and reporting all share these records. No schema/runtime changes are part of AUT-296. Detailed implementation plans follow accepted specs and require the repository's normal TDD and CI checks.

## Pragmatic Enforcer Analysis

- Necessity **9/10**: current invoices lack seller evidence and export mappings; waiting creates more unexportable history.
- Complexity **6/10**; ratio **0.67**: separate credits and artifact retention add work, but protect different invariants.
- Simpler alternative: identity/snapshot/PDF only. This is the first two milestones, but cannot fulfill the credit/export project by itself.
- Recommendation: approve phased implementation once the product and accountant gates below are resolved. No event-sourcing platform, new PDF worker, per-entity invoice renumbering or payment engine.
- Deferred decisions are recorded in `docs/internal/.architecture/deferrals.md` with re-entry triggers.

## Validation and Approval Gates

- [x] Product owner accepts both feature specs' recorded decisions, including the M1 mapping prerequisite, mistaken-credit operational limitation, preserved RE series and export/access boundaries. **Accepted 2026-09-20 — Dejan Dosenovic (Product Owner).**
- [ ] Accountant accepts country document fixtures and the export posting profile, including tax keys, debtor convention, polarity and rounding.
- [ ] DATEV official format version/schema and successful import evidence are pinned before enabling export.
- [ ] Implementation proves tenant/site isolation, concurrent finalization/credits/lock advancement, exact monetary reconciliation and immutable legacy behavior.
- [x] ADR/specs are accepted and merged before AUT-296/Milestone 0 is completed; update the project's Next section only then.

## References

- [[legal-invoicing-and-credit-notes]]; [[datev-accounting-export]].
- [[2026-04-12-invoice-snapshotting]]; [[2026-04-12-fiscal-lock-date]]; [[2026-04-12-sequential-document-numbering]]; [[2026-08-31-site-operational-scope]]; [[2026-04-12-async-pdf-pipeline]].
- Source: `apps/core-api/prisma/schema.prisma`; `src/site/legal-entity.service.ts`, `src/sales/sales.service.ts`, `src/sales/invoice-finalization.service.ts`, `src/invoices/invoices.service.ts`, `src/invoices/invoice-snapshot.ts`, `src/invoices/invoice-snapshot.resolver.ts`, `src/vehicle-stock/vehicle-sale.service.ts` under `apps/core-api`.
- Country and format references, including retrieval limits, are in the linked feature specs.

## Linear Tracking

| Field | Value |
|---|---|
| Project | [Legal Invoicing & Accounting Export](https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695) |
| Milestone | 0 — Spec & ADR (PO accepted 2026-09-20; accountant/DATEV evidence gates remain) |
| Issues | [AUT-296](https://linear.app/auto-core-platform/issue/AUT-296); implementation AUT-297–303, AUT-307 and AUT-305; AUT-306 parked |
| Next (Linear) | AUT-296 approved: ADR-0023 and legal-invoicing/datev-accounting-export specs are the implementation baseline. Begin milestone 1 (AUT-297–299), including its accountant-approved mapping prerequisite, then milestones 2 → 3 → 4. AUT-307 + AUT-305 own milestone 4. AUT-306 remains parked; country/DATEV activation gates still apply. |
