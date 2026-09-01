# AUT-252 Implementation Notes — Multi-Location: LegalEntity, Site, SiteMembership and Safe Backfill

**Date:** 2026-09-01
**Source of truth:** `docs/internal/02-Feature-Specs/Platform/2026-08-31-multi-location-sites-and-legal-entities.md`, `docs/internal/01-ADR/2026-08-31-site-operational-scope.md` (ADR-0022), `docs/deletion-policy.md`

## What was built

### Schema (`apps/core-api/prisma/schema.prisma`)

- **`LegalEntity`** — tenant-scoped, `country_iso` enum `AT | DE`, `is_active`. Tenant-safe composite unique `(tenant_id, id)` and `(tenant_id, name)`.
- **`Site`** — tenant-scoped, FK `(tenant_id, legal_entity_id) → legal_entities (tenant_id, id)` (immutable in the service layer, ruling 4). Planner fields moved onto Site: `timezone`, `slot_minutes`, `holiday_country_iso`, `holiday_subdivision_code`. Unique `(tenant_id, code)` and `(tenant_id, id)`.
- **`SiteMembership`** — access-only join (`tenant_id, user_id, site_id`). Composite FKs to `tenant_members (tenant_id, user_id)` (ruling 5) and `sites (tenant_id, id)`. No per-site role column (ruling 6).
- **`User.active_site_id`** — nullable; composite FK `(active_tenant_id, active_site_id) → sites (tenant_id, id)` (ruling 11).
- **`Bay`** and **`StorageLocation`** now carry `site_id` NOT NULL with composite FKs to `sites (tenant_id, id)`. `StorageLocation.parent_id` is a site-safe composite FK `(tenant_id, site_id, parent_id)`. `LocationType` gains **`in_transit`**; `storage_locations.is_system` marks system locations.
- **`VehicleLot` relation is `onDelete: Restrict`** (live code was `SetNull`) — a lot with a parked dealer vehicle cannot be silently dropped (ruling 45).
- **`WorkshopSettings` removed.** `WorkshopOpeningHour` / `WorkshopHoliday` are site-scoped (`site_id` FK, unique `(tenant_id, site_id, weekday)` / `(tenant_id, site_id, observed_on)`).

### Migrations

- `20260831180000_add_in_transit_location_type` — separate enum-only migration (PostgreSQL cannot use a new enum value in the same transaction that added it, error 55P04).
- `20260901000000_multi_location_legal_entity_site` — expand → backfill → validate → contract in one file:

  - **Expand:** new tables/columns nullable; drops tenant-only `workshop_holidays` unique.
  - **Backfill:** one `LegalEntity` + one `MAIN` `Site` per tenant; country fallback (`CH`/`US` → `AT` on the entity, original code preserved on the site); missing `WorkshopSettings` → `Europe/Vienna`, `30`, `AT`; system `TRANSIT` + default `LOT` locations; `SiteMembership` per `TenantMember` (is_active copied); `User.active_site_id` for active memberships; opening hours filled to exactly seven rows; holidays/opening hours/bays/locations stamped with `site_id`.
  - **Validate:** asserts zero persisted `ON_ORDER` dealer vehicles (fails the migration), zero parked dealer vehicles without a `vehicle_lot`, zero un-stamped bays/locations, and valid `active_site_id` references.
  - **Contract:** NOT NULL on `site_id` columns; composite FKs (`sites → legal_entities`, `site_memberships → sites` / `→ tenant_members`, bays/locations → sites, opening hours/holidays → sites, `users (active_tenant_id, active_site_id) → sites`, `vehicles.location_id → storage_locations` on `RESTRICT`); drops `workshop_settings` (ruling 56).

### Service layer

- **`src/site/` module (global):** `SiteService` + controller + DTOs.
  - `createLegalEntity` / `updateLegalEntity` / `deleteLegalEntity` (country immutable; deactivation 422 while any site is active; hard delete only with zero sites).
  - `createSite` (422 under inactive legal entity; immutable `legal_entity_id` enforced), `updateSite` (deactivation guards; reactivation requires active parent), `deleteSite` (pristine-only; removes empty system transit location internally).
  - `addSiteMembership` (requires active `TenantMember` — service check + composite FK), `removeSiteMembership` (clears `active_site_id` atomically).
  - `guardSiteDeactivation` (blocks on stock qty and parked dealer vehicles).
  - `resolveDefaultSiteId` — temporary MAIN-site resolver used by `BayService`, `LocationService`, `PurchaseService`, and the settings rewrite until `SiteContextService` lands.
- **`WorkshopSettingsService` rewritten** to be Site-backed; the `GET`/`PUT /api/workshop/settings` routes keep their shape and now read/write the tenant's MAIN Site (ruling 56). It lazily creates the LegalEntity+MAIN+system locations if a tenant has none.
- **`WorkshopHolidayService`, `WorkshopTaskService`, `EmployeeService`, `HrAttendanceService`** updated from tenant `WorkshopSettings` to site lookup.
- **`LocationService.remove`** now blocks system `in_transit` locations and lots with non-`SOLD` dealer vehicles (ruling 45); `BayService`/`LocationService`/`PurchaseService` stamp `site_id` on create.
- **Seed** creates the LegalEntity + MAIN Site + system locations and stamps `site_id` on warehouses.

### Tests

- `src/site/site.service.spec.ts` — 18 unit tests: creation validation, immutable `legal_entity_id`, cross-tenant rejection, deactivation/reactivation guards, membership rules, active-site clearing.
- `test/multi-location.e2e-spec.ts` — 11 e2e tests: cross-tenant composite FK rejection (site→legal entity, membership→tenant member, `active_site_id`→site, parent bin→site), system transit delete guard, lot delete guard (parked vs SOLD vehicle), site deactivation guard, migration invariants (one MAIN site, one transit, seven opening hours).
- `apps/core-api/scripts/verify-multi-location-migration.sh` — standalone backfill verification covering: missing `WorkshopSettings`, `CH` and `US` holiday country fallback, partial opening-hour rows (filled to seven), inactive `TenantMember` (membership copied inactive), bay stamping, parked dealer vehicles remediated to `MAIN LOT`, and the persisted-`ON_ORDER`-vehicle migration failure.

## Deviations and scoped limitations

1. **`site_id` on operational documents deferred.** The spec's site-owned manifest lists `workshop_orders`, `sales_orders`, `purchase_orders`, `vehicle_purchases`, `vehicle_sales`, `inventory_transactions`. These are **not** stamped in this PR: there is no `SiteContextService` yet, and making the columns NOT NULL without a session site would break every create path. They arrive with the SiteContext/operational-split issue. Consequently the site deactivation guard does not yet check document terminal statuses (only stock + parked vehicles), and `site_id` is added to the **parent/bin/bay/location** and **settings/holiday** tables only — which is what the acceptance criteria require.
2. **`guardSiteDeactivation` does not yet `SELECT … FOR UPDATE`.** AUT-65 bans `$executeRaw`, and a typed row-lock needs the operational write paths to serialize against. Documented in the service; the ruling-41 lock discipline ships with the SiteContext issue.
3. **`workshop_settings` dropped in contract**, not kept until a later release. All values were copied to Site during backfill; `getOrCreateSettings` lazily recreates a MAIN site (with legal entity + system locations) if a tenant somehow has none, so legacy tenants keep working.
4. **Realtime:** `site_context_updated` / `site_access_scope_updated` events and site rooms are **not** implemented here — they are part of the SiteContext/session issue (rulings 9–11, 37). `StockTransfer` tables are likewise deferred.
5. **`User.active_site_id` writers:** the four `active_tenant_id` writers are not yet routed through a shared tenant-change helper (ruling 11). This PR adds the composite FK + schema support; the helper is a follow-up so switch-tenant/ensureActiveMembership/invite/syncUserClaims can null `active_site_id` atomically. Because those paths currently write `active_tenant_id` alone, an existing user who later PATCHes a site could violate the FK — the backfill nulls `active_site_id` for all existing users, and e2e fixtures set both columns, so the migration and tests are safe; production writers must adopt the helper before multi-site tenant switching ships.
6. **`users (active_tenant_id, active_site_id) → sites` is a DB-only constraint, not a Prisma relation.** `active_tenant_id` is already bound to the `Tenant` relation, so Prisma cannot express the composite; the FK is added in the contract migration and deliberately unmodeled. `prisma migrate deploy` (the CI convention) applies it; `prisma migrate dev` would offer to drop it. All other new FKs match Prisma's generated definitions (`ON UPDATE CASCADE`, exact names) so `prisma migrate diff` shows no drift on the new tables.
7. **`finance_settings.next_stock_transfer_number` / `stock_transfer_prefix`** (ruling 52) and all `StockTransfer` models are out of scope for this foundation issue and were not added.

## Follow-up issues to file

- SiteContextService + session site resolution; `GET /me/sites` and `PATCH /me/active-site` (rulings 7–9, 47).
- Shared tenant-change helper for the four `active_tenant_id` writers (ruling 11) + composite-FK regression guard.
- Stamp `site_id` on site-owned documents; document site PATCH transitions (rulings 13–19).
- Ruling-41 serialized site deactivation (typed row lock) integrated with create/receipt/transfer paths.
- Stock transfers, in-transit ledger rows, `movement_group_id`, `stock_transfer_commands` (rulings 25–36).
- Vehicle dual-role projection + lot/site authorization (rulings 40, 48–49).
- Employee home site, intercompany stock moves, DACH fiscal fields / Legal Invoicing (out of scope by design).

## Verification run results

- `prisma generate` — passed.
- `prisma migrate deploy` against a clean unseeded database — passed.
- `prisma migrate deploy` against a pre-seeded legacy fixture — passed (via `verify-multi-location-migration.sh`).
- `prisma db seed` against a fresh migrated DB — passed.
- `lint:prisma-tenant` — passed.
- ESLint (`src`, `test`) — passed.
- `tsc -p tsconfig.build.json` — passed.
- Unit tests: 940 passed (123 suites).
- E2E tests: 282 passed (39 suites) against a fresh migrated DB.
