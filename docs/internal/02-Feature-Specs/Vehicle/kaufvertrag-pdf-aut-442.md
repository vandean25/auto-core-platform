---
title: "Kaufvertrag PDF with Gewährleistung terms and branded archive (AUT-442)"
date: "2026-10-09"
module: "Vehicle"
status: implemented-pending-legal-review
linear-project: "Austria Market Roadmap"
linear-milestone: "E4"
tags:
  - feature-spec
  - vehicle
  - vehicle-stock
  - gewaehrleistung
  - pdf
---

# Kaufvertrag PDF with Gewährleistung terms and branded archive (AUT-442)

## Summary

Generate a branded Kaufvertrag (purchase contract) PDF for a sold or sale-ready vehicle stock unit. The PDF states the statutory Gewährleistung facts from the AUT-408 tracker (handover date, consumer or non-consumer buyer, end date, and whether the 2-year or negotiated 1-year period applies), an optional voluntary Garantie block that is visually separate from Gewährleistung, and a short presumption note written as a research note. Each generated PDF is archived immutably together with a snapshot of the seller's legal and tax identity and its LegalEntity branding.

## User Stories

- As a dealer, I want to generate the Kaufvertrag for a sold vehicle from the sale page so that the buyer receives the contract with the correct Gewährleistung terms.
- As a dealer, I want the negotiated 1-year period to be refused when the vehicle or the buyer does not qualify, so that the contract cannot state a shortening that the rules do not allow.
- As a dealer, I want an optional voluntary Garantie to appear as its own clearly separated block, so that the buyer can tell it apart from the statutory Gewährleistung.
- As an auditor, I want each generated PDF to be stored as an immutable archive with the seller and branding snapshot it was rendered from, so that the document can be reproduced and explained later.

## Rule Contract

Gewährleistung facts are reused from AUT-408 and are not recalculated with different logic. The generation guard calls the same pure function (`computeGewaehrleistung`) and returns the same stable error codes that the sale create and patch endpoints return.

| Case | Behavior |
|------|----------|
| Consumer, no shortening | PDF states a 2-year Gewährleistung period from handover and the computed end date. |
| Consumer, negotiated shortening, qualifying vehicle | PDF states the 1-year period and the computed end date. |
| Consumer, negotiated shortening, not qualifying | Generation is refused with the AUT-408 code (for example `GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW`). No archive is created. |
| Non-consumer (B2B) | PDF states "gemäß Vertrag" and prints no computed end date. |
| Consumer | PDF prints the presumption note ("Vermutungsfrist") with its end date. |
| Garantie configured | Optional block with duration in months and terms. Omitted when no duration is set. |
| Seller country not AT | Generation is refused. The text follows Austrian law (ABGB / VGG), so a non-Austrian seller cannot use it. |
| Cancelled sale | Generation is refused. |
| Missing contract or handover date, or missing VIN | Generation is refused with a stable code. |
| Stored Gewährleistung snapshot differs from recomputed facts | Generation is refused with `KAUFVERTRAG_GEWAEHRLEISTUNG_SNAPSHOT_STALE`, so the PDF can never disagree with the tracker. |

### Presumption note wording

The PDF includes this note, marked as a research note and not legal advice: consumer purchases presume that a defect that appears within one year from handover already existed at handover (Vermutungsfrist, § 924 ABGB as amended by GRUG, RIS BGBl I 175/2021). The wording needs legal review before production use (see Open Questions).

## Database Impact

### New Tables / Columns

No new table. Nullable columns are added to `vehicle_sales`. There is no backfill and no change to existing data:

| Column | Type | Notes |
|--------|------|-------|
| `garantie_months` | Int | Voluntary Garantie duration, 1–120 months. Null means no Garantie block. |
| `garantie_terms` | Text | Optional Garantie terms, up to 2000 characters. |
| `kaufvertrag_snapshot` | Json | Frozen content of the most recently archived Kaufvertrag: sale facts, seller legal and tax identity, buyer, vehicle, Gewährleistung facts, Garantie, and branding. |
| `kaufvertrag_snapshot_sha256` | Text | SHA-256 of the snapshot (canonical JSON, `branding.resolved_at` excluded). Archive identity. |
| `kaufvertrag_archive_bucket` | Text | Bucket of the immutable archive object. |
| `kaufvertrag_archive_key` | Text | Key `vehicle-sale-kaufvertrag-archives/{tenant}/{sale}/{snapshot_sha256}/{template_version}.pdf`. |
| `kaufvertrag_archive_generation` | Text | GCS object generation. |
| `kaufvertrag_archive_sha256` | Text | SHA-256 of the PDF bytes. |
| `kaufvertrag_generated_at` | Timestamp | When the current archive was persisted. |
| `kaufvertrag_generation_error` | Text | Last generation error. Cleared before each new attempt. |

The migration is expand-only (`ADD COLUMN`, all nullable).

### Archive model

- Archive objects are written with `ifGenerationMatch: 0`, so a published object is never overwritten. Custom metadata binds the object to tenant, sale, snapshot hash, and template version.
- A second request for the same snapshot hash adopts the existing object (HTTP 412 path, verified by identity). This makes Cloud Tasks retries safe.
- The sale row points to the most recent archive. After the facts change, the next generation creates a new object with a new key. Earlier objects stay in the bucket, immutable and unreferenced.
- Archives live in the shared PDF archive bucket (`resolvePdfStorageBucket`), the same bucket as invoice archives. Retention is therefore the bucket policy that applies to invoice archives. This change adds no retention override in code.

### Deletion Policy Impact

No new entity and no new delete endpoint. Existing VehicleSale deletion behavior is unchanged. `docs/deletion-policy.md` needs no update.

## API Contract Changes

### New Endpoints

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| POST | `/api/vehicle-sales/:id/kaufvertrag/pdf` | Generate, or reuse the cached archive. Returns `cached`, `enqueued`, or `generated`. | Same as other vehicle-sale routes (global JWT guard, tenant context, active site membership). TECH mechanic sessions are not allowed. |
| GET | `/api/vehicle-sales/:id/kaufvertrag/pdf` | Stream the archived PDF. 404 "Kaufvertrag PDF is not generated yet" until ready. | Same as above. |
| POST | `/api/vehicle-sales/:id/kaufvertrag/pdf/worker` | Cloud Tasks worker. Signed payload, `PdfWorker` guards. Not for clients. | Worker secret, signed payload, tenant guard. Excluded from OpenAPI. |

### Modified Endpoints

| Method | Route | Change |
|--------|-------|--------|
| POST / PATCH | `/api/vehicle-sales`, `/api/vehicle-sales/:id` | Accept `garantie_months` (1–120, optional) and `garantie_terms` (≤2000 chars, optional). DRAFT only, like the other warranty facts. |
| GET | `/api/vehicle-sales/:id` | Returns the new columns, including `kaufvertrag_generated_at` and `kaufvertrag_generation_error`. |

### Error codes

| Code | HTTP | Condition |
|------|------|-----------|
| `GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW` | 422 | Negotiated 1-year period without a first registration more than one year before handover. Same code as AUT-408. |
| `GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED` | 422 | Negotiated 1-year period without a first registration date. |
| `GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER` | 422 | Negotiated 1-year period for a non-consumer. |
| `GEWAEHRLEISTUNG_RULE_NOT_AVAILABLE` | 422 | Contract concluded before the earliest rule set. |
| `KAUFVERTRAG_SITE_REQUIRED` | 422 | Sale has no site, so no seller legal entity can be determined. |
| `KAUFVERTRAG_SALE_CANCELLED` | 422 | Sale status is CANCELLED. |
| `KAUFVERTRAG_CONTRACT_DATE_REQUIRED` | 422 | No contract conclusion date. |
| `KAUFVERTRAG_HANDOVER_DATE_REQUIRED` | 422 | No handover date. |
| `KAUFVERTRAG_VIN_REQUIRED` | 422 | Vehicle has no VIN. |
| `KAUFVERTRAG_SELLER_COUNTRY_UNSUPPORTED` | 422 | Seller legal entity is not in AT. |
| `KAUFVERTRAG_GEWAEHRLEISTUNG_SNAPSHOT_STALE` | 422 | Stored Gewährleistung snapshot differs from the recomputed facts. |

### OpenAPI Regeneration

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`
- [ ] Commit both generated contract artifacts.

## UX Compliance

### Layout & Actions

- [x] The "Kaufvertrag-PDF" action is top-right on the sale page. Top-left stays reserved for the title and badges.
- [x] The button is disabled for unsaved or cancelled sales. It uses the shared `usePdfDownload` hook (AUT-378): post, poll until ready, download.
- [x] Failures surface through the stored `kaufvertrag_generation_error` and the 422 message, in German.

### Form Handling

- [x] Garantie inputs sit in the existing "Gewährleistung" section and use the page's existing debounced auto-save.
- [x] The negotiated-1-year checkbox is disabled when the sale page can see that the vehicle first registration is missing or not more than one year before handover, with a German explanation. The server rule remains authoritative.

### Document Layout

- [x] The vehicle table ends with "Kaufpreis (brutto)" so the price is not a separate section.
- [x] The LegalEntity logo is printed once in the running page header, not in the body, so it repeats on every page of the archive.
- [x] Gewährleistung is one section: statutory period, end date, and "gemäß Vertrag" for B2B.
- [x] The optional Garantie block has its own heading, a dashed border, and a tinted background. It is labelled as a voluntary commitment in addition to the statutory Gewährleistung.
- [x] The presumption note is a boxed research note with the disclaimer "keine Rechtsberatung".

### Real-Time Sync

- [x] No new entity type. The sale-detail cache is invalidated after generation. No outbound email, SMS, or message.

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| Generation guard (pure) | `apps/core-api/src/vehicle-stock/kaufvertrag/kaufvertrag-facts.ts` | Validates the sale and reuses `computeGewaehrleistung`. Returns facts or throws a stable 422. |
| Snapshot (pure) | `apps/core-api/src/vehicle-stock/kaufvertrag/kaufvertrag-snapshot.ts` | Builds the frozen snapshot and its canonical hash. |
| Layout (pure) | `apps/core-api/src/vehicle-stock/kaufvertrag/kaufvertrag-pdf.layout.ts` | HTML for the Kaufvertrag. |
| Renderer | `apps/core-api/src/vehicle-stock/kaufvertrag/kaufvertrag-pdf.renderer.ts` | Playwright HTML to PDF with bundled fonts and external requests blocked. |
| Service | `apps/core-api/src/vehicle-stock/kaufvertrag/kaufvertrag-pdf.service.ts` | Request, generate, archive, and stream. Tenant and site scope on the request path. |
| Generic immutable object methods | `apps/core-api/src/common/pdf/pdf-storage.ts` | Publish and read archive objects with custom identity metadata. Invoice methods delegate to them. |
| Sale form | `apps/core-web/src/pages/vehicle-stock/VehicleSalePage.tsx` | Garantie inputs, negotiated-1-year guard in the UI, and the PDF action. |

## Testing Plan

### Backend Unit

- [x] Guards: 2-year default; negotiated 1-year qualifying; blocked 1-year cases (too new, missing first registration, B2B shortening); B2B no dates; cancelled; missing dates; missing VIN; non-AT seller; stale snapshot.
- [x] Snapshot: hash stable across branding `resolved_at` changes; changes with Garantie or facts.
- [x] Layout: 2-year and 1-year wording, Garantie block only when configured, presumption research note, B2B wording, HTML escaping of Garantie terms.
- [x] Storage: create-only publication, adoption by key only when identity validates, and exact-generation reads that reject mismatched metadata (generic archive methods in `pdf-storage.ts`; invoice behaviour covered by the existing archive specs).
- [x] Service: guard failures refuse before any dispatch or storage write; cache hit on unchanged snapshot; new archive when facts change; immutable publish with identity metadata; adoption on 412 with identity check; persist guarded by tenant; GET 404 until generated; tenant and site scope in query filters.

### Backend E2E

- [x] Happy path: create sale, generate, download `%PDF`, cached second request, new archive after a change.
- [x] Blocked negotiated 1-year: 422 with the AUT-408 code and no archive.
- [x] Tenant isolation: another tenant cannot generate or download (404).
- [x] Site isolation: a sale on a site outside the active membership is not found (404).
- [x] Negotiated 1-year refused when saving the sale (PATCH, 422) and at generation (POST, 422, no archive written).
- [x] Cloud Tasks worker (`test/vehicle-sale-kaufvertrag-worker.e2e-spec.ts`): a signed payload archives the PDF (204); a missing worker secret is refused (401); a payload for another document kind or another sale is refused (403); a non-retryable blocked 1-year task is dropped (204) and the reason is stored for the poll; a payload signed for another tenant cannot archive this sale.
- [x] Generation and download use the create-only in-memory archive from `test/support/in-memory-pdf-archive.ts`; the renderer is real Chromium.

### Frontend

- [x] Sale page: PDF action wiring and disabled states; Garantie fields in the payload; negotiated-1-year guard message.

### Contract and CI

- [ ] OpenAPI and frontend types regenerated and in sync (`openapi:check`, `api:types:check`).
- [ ] `npm run ci` passes except for the known local failures recorded in the PR.

## Impact Analysis

- **Database:** additive nullable columns on `vehicle_sales`. No new entity and no backfill.
- **State machine:** no new status. Generation is allowed for DRAFT and INVOICED sales and refused for CANCELLED.
- **Deletion:** no new delete path.
- **Real-time:** existing vehicle-sale cache invalidation is enough.
- **API:** three new routes, two DTO additions, OpenAPI regeneration.
- **Storage:** new archive key prefix in the shared PDF archive bucket. The invoice archive contract is unchanged.
- **Finance:** no effect on invoice amounts, tax, numbering, or lifecycle. The Kaufvertrag does not show NoVA or trade-in netting (AUT-405 / AUT-443).
- **External effects:** none.

## Open Questions

1. **Legal review gate (ADR-0023):** the Gewährleistung wording, the presumption note, and the Garantie block need legal or accountant review before the copy is used in production. This spec is a research note and not legal advice.
2. The Garantie block states the duration "ab Übergabe". Confirm the start date with the legal reviewer.
3. The archive bucket retention is inherited from invoices. Confirm the retention period for the Kaufvertrag archive with infrastructure.
4. Buyer contact data (email and phone) is copied into the snapshot, as invoices already do. Confirm the data-minimisation position for the Kaufvertrag.

## References

- AUT-442 issue text (Linear), AUT-408 spec (`gewaehrleistung-tracking-aut-408.md`)
- AUT-378 shared PDF download hook, AUT-405 NoVA (out of scope here), AUT-443 trade-in netting (out of scope here), AUT-387 Junge Sterne (out of scope here)
- [WKO: Verkauf von Gebrauchtwagen](https://www.wko.at/handel/fahrzeughandel/verkauf-von-gebrauchtwagen)
- [RIS: BGBl I 175/2021 (GRUG)](https://www.ris.bka.gv.at/eli/bgbl/I/2021/175)
- [RIS: BGBl I 60/2026 (WaRUG)](https://www.ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2026_I_60/BGBLA_2026_I_60.html)
- `docs/internal/01-ADR/2026-04-12-openapi-contract-first.md`

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | Austria Market Roadmap |
| Milestone | E4 |
| Issues | AUT-442 |
