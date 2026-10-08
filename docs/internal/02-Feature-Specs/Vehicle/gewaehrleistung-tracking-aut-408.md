---
title: "Gewährleistung tracker on sold vehicles (AUT-408)"
date: "2026-10-08"
module: "Vehicle"
status: implemented-pending-legal-review
linear-project: "Austria Market Roadmap"
linear-milestone: "E4"
tags:
  - feature-spec
  - vehicle
  - vehicle-stock
  - gewaehrleistung
---

# Gewährleistung tracker on sold vehicles (AUT-408)

## Summary

Add handover and buyer-type details to a vehicle sale and snapshot the applicable statutory Gewährleistung and presumption dates. Staff can see dates on the sold vehicle and query upcoming Gewährleistung end dates. The tracker is informational: it does not create a Kaufvertrag, provide legal text, track claims or voluntary Garantie, or send messages.

## User Stories

- As a dealer, I want to record the handover date, whether the buyer is a consumer, and whether a qualifying shortening was individually negotiated so that the sale record reflects the agreed statutory period.
- As a dealer, I want to see the base Gewährleistung period and presumption dates on a sold vehicle and list base periods ending within 30, 60, or 90 days so that I can identify relevant records.
- As an auditor, I want the rule version and sources stored with each computed snapshot, and finalized snapshots protected from silent recomputation, so that historic calculations remain explainable.

## Rule Contract

The engine is a pure, time-independent, versioned function, following the Pickerl rule-set pattern. It selects the applicable rule-set using the contract conclusion date and calculates the base period from the handover date. A legal-rule change adds a new rule-set version; a published version is never edited.

| Case | Tracker behavior |
|------|------------------|
| Consumer purchase of a used dealer vehicle, no qualifying negotiated shortening | Gewährleistung end date is two years from handover. |
| Consumer purchase, negotiated shortening requested | One-year period is valid only if first registration is more than one year before handover and the shortening was individually negotiated. Otherwise return a stable validation error. |
| Consumer purchase | Presumption end date is one year from handover. |
| B2B | Preserve buyer flag and show “B2B – per contract”; do not compute statutory end dates. |
| Missing handover | No computed snapshots. |
| Leap-day handover | Calendar-year addition is deterministic and covered by unit tests. |

Every computed record stores rule source and version. Initial source set: WKO, “Verkauf von Gebrauchtwagen”, and RIS BGBl I 175/2021 (GRUG 2022). Current rule text and applicability require Legal Researcher confirmation before merge.

### Implemented calculation decisions

- Rule IDs are `at-used-vehicle-vgg-2022-v1` (contracts from 2022-01-01) and `at-used-vehicle-vgg-2026-10-v2` (contracts from 2026-10-01). The latter cites RIS BGBl I 60/2026 (WaRUG) and explicitly excludes qualifying repair extensions from the calculated base end date.
- Dates use UTC calendar days. Anniversary dates keep the month/day where valid and clamp to the target month’s last day (29 February becomes 28 February in a non-leap year). The computed end date is inclusive.
- The due list includes `[today, today + endsWithinDays]`, inclusive, and excludes past dates, B2B sales, and missing snapshots. Ordering is end date then stable sale ID.
- Missing contract or handover dates produce no computed snapshot. Contracts before 2022-01-01 return `GEWAEHRLEISTUNG_RULE_NOT_AVAILABLE` rather than guessing a rule.
- The visible end-date label is “Basisfrist bis …”; it does not state that all legal rights have ended. Qualifying repair extensions are not tracked.

## Database Impact

### New Tables / Columns

No new table. Add nullable columns to `vehicle_sales`; no backfill and no NOT NULL change to existing data:

| Table | Column | Type | Nullable | Notes |
|-------|--------|------|----------|-------|
| `vehicle_sales` | `contract_concluded_at` | Date | Yes | Date the contract was concluded; identifies applicable statutory rule periods, including effective-date transitions. |
| `vehicle_sales` | `handed_over_at` | Date | Yes | Handover date. |
| `vehicle_sales` | `buyer_is_consumer` | Boolean | Yes | On creation, default from customer type (`PRIVATE` true, `COMPANY` false); user may explicitly set the captured buyer flag. |
| `vehicle_sales` | `gewaehrleistung_shortened_negotiated` | Boolean | Yes | Application default false. Valid only for consumer sale with vehicle first registration more than one year before handover. |
| `vehicle_sales` | `gewaehrleistung_note` | Text | Yes | Optional note. |
| `vehicle_sales` | `gewaehrleistung_ends_on` | Date | Yes | Base-period rule snapshot, computed when contract date and handover are set. No date for B2B. |
| `vehicle_sales` | `presumption_ends_on` | Date | Yes | Base-period rule snapshot, computed for consumer sale when contract date and handover are set. No date for B2B. |
| `vehicle_sales` | `gewaehrleistung_rule_version` | Text | Yes | Identifies immutable rule-set version used for snapshots. |

Migration is expand-only and dated after `20261008100000_aut410_schedule_site_assignment`.

### Modified Tables

| Table | Change | Migration Required? |
|-------|--------|---------------------|
| `vehicle_sales` | Add nullable handover, consumer, negotiated-shortening, note, and snapshot columns. | Yes, additive only. |

### Snapshot and Audit Rules

- Compute base-period snapshots when contract conclusion date and handover are set or when editable sale inputs change before invoice finalization.
- After `VehicleSale.status = INVOICED`, do not silently recompute snapshots. Any correction must be an explicit action, be audited through the existing AuditLog and audit helpers, and preserve the prior snapshot in the audit trail.
- Select authorization for the correction action from existing vehicle-sale RBAC; do not add a role or bypass tenant/site guards.
- `buyer_is_consumer` is the captured transaction fact. Customer type supplies only its create-time default; later customer-type edits do not rewrite historical sale facts.

### Deletion Policy Impact

No new entity or delete endpoint. Existing VehicleSale deletion behavior is unchanged; check `docs/deletion-policy.md` before implementation and do not expand deletion scope.

## API Contract Changes

### New Endpoints

| Method | Route | Request Body | Response | Auth |
|--------|-------|-------------|----------|------|
| GET | `/vehicle-stock/gewaehrleistung-due` | Query: `endsWithinDays=30\|60\|90` | Read-only list of sold vehicles whose computed base period ends in the selected window, ordered by end date; DTO shape follows `PickerlDueListDto`. | Existing vehicle-stock read RBAC; tenant and active-site scoped. |

### Modified Endpoints

| Method | Route | Change Description |
|--------|-------|--------------------|
| Existing | Vehicle sale create/patch routes | Accept handover date, consumer flag, negotiated-shortening flag, and note; return snapshots, source/version, and validation errors. |
| Existing | Vehicle read/detail route | Expose sale base-period and presumption snapshot fields needed by the detail badge. |
| New action | `POST /vehicle-sales/:id/gewaehrleistung-correction` | Explicit audited correction of finalized snapshots; existing sale authorization plus tenant and authorized-site scope. |

Validation errors use stable machine codes and German user-facing messages for missing first registration, insufficient vehicle age, and non-consumer buyer.

### OpenAPI Regeneration

- [x] `npm --prefix apps/core-api run openapi:generate`
- [x] `npm --prefix apps/core-web run api:types:generate`
- [x] Commit both generated contract artifacts.

## UX Compliance

### Layout & Actions

- [x] Page-level actions remain top-right aligned.
- [x] Top-left remains reserved for breadcrumbs / title / badges.
- [x] Existing page header styles are retained.

### List Pages (if applicable)

- [x] Provide 30 / 60 / 90 day filter, stable end-date ordering, and the existing Pickerl due-list shape/pattern.
- [x] Reuse shared list patterns where applicable; list is read-only and has no delete action.

### Form Handling

- [x] Add “Übergabe & Gewährleistung” section on `VehicleSalePage.tsx` with contract/handover dates, consumer flag, negotiated-shortening checkbox, and note.
- [x] Preserve the page’s debounced multi-field auto-save behavior and show validation in German.

### Vehicle Detail

- [x] Show “Basisfrist bis <date>” and “Vermutungsfrist bis <date>” badges; B2B shows “B2B – per contract” without dates. Explain that later repair-based extensions are not represented; do not show an expired/no-liability state.

### Real-Time Sync

- [x] No new entity type; use existing sale/vehicle cache invalidation patterns. No outbound email, SMS, or other messages.

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| Versioned rule sets and pure calculator | `apps/core-api/src/vehicle-stock/gewaehrleistung/` | Select a pinned rule version using contract conclusion date and calculate consumer base-period dates or B2B no-date result. |
| Sale input and snapshot service logic | `apps/core-api/src/vehicle-stock/vehicle-sale.service.ts` | Apply customer-type default, validation, snapshot calculation, and invoiced guard. |
| Explicit correction action | Vehicle sale controller/service and existing audit helpers | Audited correction of a finalized snapshot. |
| Sale form section | `apps/core-web/src/pages/vehicle-stock/VehicleSalePage.tsx` | Capture handover and buyer agreement facts. |
| Vehicle badges | `apps/core-web/src/pages/vehicles/VehicleDetail.tsx` and vehicle section component | Display dates/status. |
| Due list | Adjacent to `apps/core-web/src/pages/vehicles/PickerlDueList.tsx` | Read-only 30/60/90-day list and route. |

## Testing Plan

### Backend Unit

- [x] Pure function cases: B2C two-year default; valid negotiated one-year; first registration exactly one year before handover rejected; missing registration rejected; B2B no dates; one-year presumption; leap-day handover; pinned rule version.
- [x] Service tests: customer type defaults; invalid shortening cases return stable codes; changing pre-invoice inputs refreshes snapshots; invoiced snapshots are preserved unless explicit correction action runs and writes audit data.

### Backend E2E

- [ ] Create/patch sale and verify snapshot dates and rule version.
- [ ] Verify validation codes for missing first registration, insufficient age, and B2B shortening.
- [ ] Verify invoiced snapshot guard and explicit audited correction.
- [ ] Verify due-list 30/60/90 filters, end-date ordering, tenant isolation, and active-site isolation.

### Frontend

- [x] Test sale section defaults and shortening explanation/validation.
- [x] Test vehicle badges for B2C and B2B, including unknown legacy snapshots.
- [x] Test due-list filters, sidebar navigation, and read-only row presentation.
- [ ] Visual QA on demo tenant using one B2C two-year, one B2C negotiated one-year, and one B2B seed example.

### Contract and CI

- [x] Regenerate OpenAPI and frontend types; `npm --prefix apps/core-api run openapi:check` passes.
- [ ] `npm run ci` (Windows run is blocked by a pre-existing LF/CRLF assertion; the parallel run also timed out two PDF parser tests. Serial backend run passed 326/327 suites, with only the newline assertion failing; all 853 frontend tests pass.)
- [x] `npm --prefix apps/core-api run openapi:check`

## Impact Analysis

- **Database:** additive nullable fields on the existing `VehicleSale`; no new entity and no data backfill.
- **State machine:** no new status. `INVOICED` is the immutability boundary; correction must be explicit, audited, and authorized.
- **Deletion:** no new delete path; retain existing VehicleSale rules.
- **Real-time:** existing vehicle-sale/vehicle cache behavior is sufficient; no new dashboard entity mapping is proposed.
- **API:** extends sale DTOs and vehicle reads, adds a read-only site-scoped due-list route and an audited correction action; both OpenAPI artifacts must be regenerated.
- **Vehicle ledger:** demo fixtures include matching purchase and sale ledger entries; the feature itself does not change ledger behavior.
- **Finance:** does not change invoice amounts, tax, numbering, fiscal dates, or invoice lifecycle.
- **UX:** adds sale form fields, detail badges, and read-only due list; existing role and active-site patterns apply.
- **Seed:** add exactly one B2C two-year example, one B2C negotiated one-year example, and one B2B example without exposing any pilot-customer identity.
- **External effects:** no email, SMS, notification, or other outbound message.
- **Seed verification:** three synthetic, finalized sale examples are added with matching invoice snapshots and purchase/sale ledger state. Focused fixture tests pass; DB-backed seed verification and visual QA remain unrun because PostgreSQL is unavailable.

## Open Questions

1. **Legal Researcher confirmation required before merge:** confirm the rule text, sources, date arithmetic, and consumer/B2B interpretation for the Austrian dealer use case. This is a review gate, not an implementation-time assumption.
2. RIS BGBl I 60/2026 added VGG §10(2a): a qualifying improvement can extend the Gewährleistungsfrist once by one year for contracts concluded after 2026-09-30. AUT-408 tracks and labels only the **base handover-derived end date**; it does not represent claim/repair-based extensions and must not imply that the date definitively establishes that no liability remains. No extension-event API or schema is added. Store contract conclusion date and rule version so the applicable rule period remains identifiable.
3. Confirm the project’s chosen date inclusivity convention for “bis” and the 30/60/90-day boundary, including whether the handover day maps to the same calendar date two years later and leap-day fallback.
4. Confirm the existing VehicleSale audit helper fields and role policy to use for post-invoice corrections; the action must be traceable and must not expose cross-tenant or cross-site sale data.

## References

- AUT-408 issue request, pasted by the user.
- [WKO: Verkauf von Gebrauchtwagen](https://www.wko.at/handel/fahrzeughandel/verkauf-von-gebrauchtwagen)
- [RIS: BGBl I 175/2021 (GRUG)](https://www.ris.bka.gv.at/eli/bgbl/I/2021/175)
- [RIS: BGBl I 60/2026 (WaRUG)](https://www.ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2026_I_60/BGBLA_2026_I_60.html)
- `docs/internal/02-Feature-Specs/Vehicles/pickerl-57a.md`
- `docs/internal/02-Feature-Specs/Vehicle/vehicle-stock-trading.md`
- `docs/internal/01-ADR/2026-08-15-vehicle-stock-not-parts-inventory.md`
- `docs/internal/01-ADR/2026-04-12-openapi-contract-first.md`

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | Austria Market Roadmap |
| Milestone | E4 |
| Issues | AUT-408 |

---
