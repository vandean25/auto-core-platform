---
title: "ADR-0031: incadea Migration and Hard Cutover to ACP"
date: "2026-10-19"
status: accepted
deciders: "Dejan Dosenovic (Product Owner); approved decision recorded in AUT-620"
linear-project: "incadea Migration"
tags: [adr, migration, platform, finance]
---

# ADR-0031: incadea Migration and Hard Cutover to ACP

## Status

**Accepted — 2026-10-19.** This records the Product Owner's approved strategy in [AUT-620](https://linear.app/auto-core-platform/issue/AUT-620). Acceptance authorizes the migration baseline; it does not certify that importers, archive controls or cutover prerequisites are implemented or that production cutover is approved.

ADR-0023 remains unchanged. Discovery questions in AUT-390 and the rehearsal gates below remain open until evidence is recorded.

## Context

ACP will replace incadea for the pilot customer. A single migration strategy is needed so individual import tickets do not introduce a parallel operational system, duplicate fiscal history or depend on proprietary source internals.

The existing [legacy import](../02-Feature-Specs/Platform/legacy-import.md) provides customer, vehicle, supplier-price-list and labor-operation imports with dry-run/apply and `ExternalIdMapping`. This is a foundation, not an implemented full-dealership migration. In particular, the current schema has no `LegacyDocument` aggregate. Its retention, related importers and dealer-domain prerequisites require subsequent implementation.

The local source-symbol inspection supports treating billing parties, warranty/goodwill, vehicle parties and historical documents as distinct migration concerns. It does not establish the pilot customer's productive configuration, data completeness, export rights or fiscal readiness. No proprietary definitions or excerpts are reproduced here.

## Decision Drivers

- Establish one operational writer and an unambiguous fiscal-period boundary.
- Preserve historical evidence without creating new ACP invoices from old documents.
- Make retries and rehearsals reconcilable across several source companies.
- Keep proprietary extraction outside ACP and use one source-agnostic import contract.
- Require verified ownership, privacy, accounting and fiscal readiness before go-live.

## Decision

### 1. Replace incadea at a hard cutover

Run **1–2 rehearsals** in a non-production tenant before switching at a **month/VAT-period boundary**. Rehearsal evidence must demonstrate the agreed scope, dependency order, idempotent retries, reconciliation and achievable freeze window. An unresolved blocking discrepancy requires correction and another rehearsal before go-live.

Freeze source writes, take the final extract and any controlled final delta, reconcile and obtain the named business/operations/accounting sign-offs before enabling ACP production writes on day 1 of the new period. The last VAT period belongs to incadea; ACP accounting exports begin at cutover. There is **no parallel run**, dual posting or continuing bidirectional synchronization. Historical read-only access to the old system is compatible with this decision.

Before go-live, a failed gate means staying on incadea. After ACP goes live, **fix forward**; do not switch writers back and create divergent numbered documents or stock movements. [AUT-634](https://linear.app/auto-core-platform/issue/AUT-634) owns the operational runbook, owners, dates and checklist.

### 2. Use only canonical migration CSV v1 plus manifest

The sole migration interface into ACP is **canonical migration CSV v1 + `manifest.json`**, specified by [AUT-621](https://linear.app/auto-core-platform/issue/AUT-621). Its specification will live at `docs/internal/02-Feature-Specs/Platform/migration-csv-format.md`; that separate deliverable is not defined by this ADR.

The read-only extractor lives **outside the ACP repository in a separate private repository**. It translates the source into ACP/dealer-domain vocabulary. ACP receives canonical files, not proprietary schemas, database connections or source-specific query logic.

**IP rule:** ACP code, fixtures, documentation, commits and PRs contain no source-system table IDs, proprietary table/field names or source excerpts. Tests and examples use synthetic data and the canonical contract. Use only “pilot customer” in repository and PR material.

The manifest identifies the format version, source company, source namespace, extraction timestamp and cutover date. It carries per-file SHA-256 and row counts plus the agreed control totals: historical net/VAT/gross by year-month, open-item totals, opening-stock value and counts by type. The importer verifies these before apply; reconciliation evidence is required before go-live. Exact columns, validation and manifest schema belong to AUT-621.

### 3. Map ownership explicitly and preserve external identity

One source company maps to **exactly one ACP `LegalEntity`**. A legal-form change creates a **new legal entity in the same tenant**; never relabel the historical seller as the successor. Several source companies are supported, each with its own legal entity and stable `source_system = 'incadea:<source company>'` namespace. Namespace construction follows AUT-621 and must be identical across rehearsals and final extraction.

Use the existing `ExternalIdMapping` identity `(tenant_id, entity_type, source_system, external_id)` for idempotency. Source IDs need not be globally unique across companies or entity types. Replaying the same accepted input resolves to the same ACP entity and must not duplicate opening ledger entries, historical documents or open-item balances. Changed input and final deltas require explicit reconciliation under the importer's policy; a mapping alone is not proof of safe replay for every domain.

Record the company-to-entity mapping and explicit site assignments before importing. Tenant-wide CRM identity stays tenant-wide; site-owned orders, stock and historical access require authorized site ownership under ADR-0022. Never infer historical seller/site from today's active switcher, and never merge historical legal entities because customer names or VINs match.

### 4. Apply in dependency order

| Order | Data | Required boundary |
|---|---|---|
| 1 | Master data | Legal entities/sites and agreed configuration, customers, vehicles and vendors; establish external identity. |
| 2 | Vehicle parties, due dates and notices | Resolve master-data references; preserve distinct party roles. |
| 3 | Labor and parts | Labor operations, standard times, price groups/packages and parts catalog. |
| 4 | Opening stock | Reconciled cutover quantities/value per authorized site/location, posted through the inventory ledger; never direct stock-cache updates. |
| 5 | Tyre sets | Resolve customer/vehicle and storage ownership. |
| 6 | Open orders, tasks and lines | Resolve parties, cost bearers, labor and parts without replaying already posted stock or financial effects. |
| 7 | Historical documents and lines | Read-only `LegacyDocument` tables; no ACP issuance, numbering or accounting postings. |
| 8 | Open items | Accounting-owned balances for display and reconciliation only. |

Each stage must resolve required references and reconcile before dependent stages proceed. Reject or report unresolved/ambiguous ownership rather than guessing. Close or submit open warranty claims in the source before cutover; their migrated representation is read-only history. Finish partially invoiced orders in the source rather than recreating their already invoiced portions in ACP.

### 5. Separate legacy evidence from ACP fiscal documents

Store imported historical headers/lines in **read-only `LegacyDocument` tables**, separate from `Invoice`, invoice sequences and accounting exports. These tables are a required target design, not a claim about today's schema.

**ACP legacy documents are not the archive of record.** The retained source-system export remains the archive of record, with a named custodian, a readable export/backup and original attachments secured before source licences end. ACP is an access copy. The archive export format and retention details require the customer's tax adviser to review them before cutover, as specified in AUT-634.

For each legacy document:

- Preserve the **raw source row unchanged** as received through the canonical CSV boundary, and the **original PDF if present**, each with its own **SHA-256**. Do not substitute normalized fields or a newly rendered PDF for the retained bytes. Proprietary originals remain in the external source archive; no proprietary source schema is introduced into ACP to retain this evidence.
- Use **write-once storage**, with `retain_until = 31 December of (document year + 7)` and a **`legal_hold`** flag. For example, a 2026 document has a minimum retention date of 2033-12-31. A legal hold prevents deletion even after that date; retention expiry does not itself authorize deletion.
- Display the exact read-only label **“Altbeleg aus Vorsystem (incadea), nicht in ACP erstellt”**.
- Keep original document numbers and dates. Never assign an ACP invoice number, re-issue the document or re-render it as an ACP invoice. If no original PDF exists, report that absence; do not fabricate one. Secure available original PDFs before source access ends.
- A correction is a **new ACP document referencing the old document number**, with the applicable issuance and accountant checks. Do not edit the legacy document or invent an `Invoice` predecessor to force it through an unsupported correction flow; that flow needs its own implementation evidence.

ADR-0023's immutability, snapshot, numbering and export rules remain intact: no legacy data enters ACP invoices, numbering or accounting export. A newly issued corrective document is an ACP fiscal event; the imported original remains excluded.

The current 180-day purge of applied `ImportJobRow` payloads is **not** document retention. Required raw rows/PDFs and hashes must be durably retained outside those disposable staging rows before purge eligibility. `ExternalIdMapping` remains reconciliation identity, not the archive.

### 6. Keep open receivables in accounting

Open receivables and other imported open items remain owned and settled by the accounting system. ACP displays their source identity, original number/date and imported balance for reference. Importing or displaying them must not issue invoices, consume sequence numbers, export bookings or create a second settlement ledger. Reconcile the opening total with accounting; never silently overwrite the authoritative accounting balance.

### 7. Require dealer, privacy and fiscal readiness

**Dealer-domain cutover blockers:** split invoicing by cost bearer (**customer / warranty / goodwill / internal**), a distinct **bill-to customer**, and **vehicle parties** must be implemented and verified for the migrated workflows. A customer or vehicle import alone does not satisfy these prerequisites.

**Customer-data rule:** apply the approved project policy of **7 full calendar years + the current year**, always include customers with **open matters**, and mark customers **inactive for 3+ years as restricted**. Open matters override age-based exclusion, not access restrictions. Restriction is not deletion or marketing consent. Data outside the selected scope needs an explicit documented retention basis; do not import all personal data by default. AUT-621 excludes unnecessary personal-data categories, and migration does not manufacture marketing consent.

**DPA gate:** an Article 28 DPA between the dealership and ACP must be signed **before any real-data import, including rehearsals**, and the dealership privacy notice must list ACP as processor. Use synthetic data until that gate passes.

**RKSV gate:** ACP can sign cash/card receipts itself through the fiscal provider using `LegalEntity.rksv_mode = REQUIRED_ACP_RKSV` and `FiscalRegister` / `FiscalReceipt`. An external register is **not mandatory** for counter sales. `REQUIRED_EXTERNAL_KASSE` remains a per-legal-entity option. The selected register/signing path must be operational from cutover with no gap; choosing an enum value alone does not prove readiness.

AUT-634 owns the RKSV/DPA checklist and evidence: confirm whether the old register was used; where applicable retain the closing receipt and DEP export, complete FinanzOnline retirement, and handle the annual receipt first at a year-end cutover. The privacy/retention requirements here record AUT-620's legal-memo-08 baseline; they are not a new legal opinion or evidence of customer/accountant sign-off.

### 8. Verify working assumptions at the first rehearsal

Working assumptions recorded by **Dejan, 2026-10-19**:

| Assumption | Required verification at first rehearsal |
|---|---|
| One source company per ACP legal entity; multi-company migration is supported with a separate namespace/entity for each. | Inventory productive/old/test companies, confirm legal identities and legal-form-change history, and approve company/entity/site assignments. |
| ACP signs receipts with `REQUIRED_ACP_RKSV`. | Confirm the pilot's register use, selected per-entity mode and provider/register readiness; record external-register exceptions explicitly. |

Keep unresolved discovery answers in [AUT-390](https://linear.app/auto-core-platform/issue/AUT-390), with the export sample in [AUT-391](https://linear.app/auto-core-platform/issue/AUT-391). A failed assumption requires a recorded decision update before production cutover.

## Consequences

### Positive

- One operational writer and a clear fiscal boundary simplify reconciliation.
- Canonical files isolate ACP from proprietary extraction and allow later source systems to reuse the contract.
- Original evidence and external identity remain traceable without polluting ACP fiscal history.

### Negative

- A controlled downtime window and successful rehearsals are necessary; incomplete readiness postpones cutover.
- The source archive and its custodian remain necessary after replacement, alongside ACP's retained access copies.
- Dealer workflows, immutable evidence storage and migration importers must be delivered before the strategy is executable.

### Neutral

- This ADR adds no schema migration, API, runtime behavior, document sequence or accounting profile.
- Detailed CSV definitions and operational procedures remain separate deliverables in AUT-621 and AUT-634.

## Alternatives Considered

| Option | Benefit | Reason rejected |
|---|---|---|
| ACP as a satellite next to incadea | Smaller initial functional scope | Conflicts with the approved replacement goal and retains two operational systems. |
| Parallel run / dual posting | Apparent fallback during transition | Creates competing stock, order and fiscal histories and ambiguous ownership. |
| Re-create historical records as ACP invoices | Reuses current invoice screens | Risks duplicate issuance and numbering under §11 UStG; violates ADR-0023's history, numbering and export boundary. |
| Extractor inside the ACP repository | One repository for migration tooling | Violates the IP boundary by coupling ACP to proprietary source internals. |

## Implementation and Validation

This is a documentation-only baseline. AUT-621 defines the canonical contract; subsequent migration tickets implement import domains, retention/access controls and reconciliation. AUT-634 consolidates their evidence into the cutover runbook. No schema/code change, OpenAPI regeneration or deletion-policy change is made by this ADR; implementation tickets introducing the target entities must update that policy.

Before cutover, evidence must prove tenant/site isolation, company separation, same-input retries without duplicate effects, hashes/control totals, immutable legacy evidence and hold behavior, retained original numbering, exclusion from ACP invoice/export flows, privacy filtering and the dealer/RKSV/DPA gates. Acceptance of this ADR does not mark those checks as passed.

## Pragmatic Enforcer Analysis

- Necessity **9/10**: independent migration tickets need a shared ownership, fiscal and evidence boundary now.
- Complexity **4/10**, ratio **0.44**: one file contract, the existing identity mapping and a bounded cutover avoid a synchronization platform.
- Simpler alternative considered: customer/vehicle import only. It cannot replace the productive dealership workflows and would retain the rejected satellite model.
- Assessment: appropriate scope; record the approved strategy now and leave schema, extractor and runbook implementation to their named tickets.

## References

- [Legacy DMS CSV import](../02-Feature-Specs/Platform/legacy-import.md).
- [ADR-0023: Legal Invoice Snapshots, Credit Notes and Accounting Export](2026-09-20-legal-invoicing-and-accounting-export.md).
- [ADR-0022: Site Operational Scope](2026-08-31-site-operational-scope.md); [ADR-0002: Ledger-Based Inventory](2026-04-12-ledger-based-inventory.md).
- ACP implementation evidence: `apps/core-api/prisma/schema.prisma` (`ExternalIdMapping`, `LegalEntity`, `FiscalRegister`, `FiscalReceipt`); `apps/core-api/src/import/import.constants.ts` and `import-retention.helpers.ts`.
- Canonical CSV v1 specification: AUT-621 (planned `docs/internal/02-Feature-Specs/Platform/migration-csv-format.md`).
- Cutover runbook: AUT-634 (planned `docs/internal/05-Runbooks/incadea-cutover.md`).

## Linear Tracking

| Field | Value |
|---|---|
| Project | incadea Migration |
| Decision | [AUT-620](https://linear.app/auto-core-platform/issue/AUT-620) — approved strategy, recorded by Dejan's request |
| Contract | [AUT-621](https://linear.app/auto-core-platform/issue/AUT-621) — canonical migration CSV v1 + manifest |
| Runbook | [AUT-634](https://linear.app/auto-core-platform/issue/AUT-634) — rehearsal, archive, DPA/RKSV and hard-cutover checklist |
| Discovery / export evidence | [AUT-390](https://linear.app/auto-core-platform/issue/AUT-390); [AUT-391](https://linear.app/auto-core-platform/issue/AUT-391) |
