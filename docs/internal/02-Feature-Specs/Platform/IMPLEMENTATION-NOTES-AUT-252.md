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

  - **Expand:** new tables/columns nullable; drops tenant-only `workshop_holidays` unique. A **PREFLIGHT** section at the very top fails on persisted `ON_ORDER` dealer vehicles **before any mutation** (Prisma Migrate wraps each migration in a transaction for PostgreSQL — verified empirically — so a mid-script failure rolls back all DDL+DML; explicit `BEGIN/COMMIT` is deliberately omitted because an inner `COMMIT` would commit Prisma's wrapping transaction early).
  - **Backfill:** one `LegalEntity` + one `MAIN` `Site` per tenant; country fallback (`CH`/`US` → `AT` on the entity, original code preserved on the site); missing `WorkshopSettings` → `Europe/Vienna`, `30`, `AT`; system `TRANSIT` + default `LOT` locations; `SiteMembership` per `TenantMember` (is_active copied); `User.active_site_id` for active memberships; opening hours filled to exactly seven rows; holidays/opening hours/bays/locations stamped with `site_id`.
  - **Validate:** asserts zero persisted `ON_ORDER` dealer vehicles (fails the migration), zero parked dealer vehicles without a **same-tenant** `vehicle_lot` (`sl.tenant_id = v.tenant_id`), zero un-stamped bays/locations, and valid `active_site_id` references.
  - **Contract:** NOT NULL on `site_id` columns; composite FKs (`sites → legal_entities`, `site_memberships → sites` / `→ tenant_members`, bays/locations → sites, opening hours/holidays → sites, `users (active_tenant_id, active_site_id) → sites`, `vehicles (tenant_id, location_id) → storage_locations (tenant_id, id)` on `RESTRICT`); drops `workshop_settings` (ruling 56). The vehicle→lot FK is tenant-safe at the DB boundary (ADR-0013) and is a DB-only constraint (Prisma cannot model it because `Vehicle.tenant_id` is already bound to the Tenant relation).

### Service layer

- **`src/site/` module (global):** `SiteService` + controller + DTOs.
  - `createLegalEntity` / `updateLegalEntity` / `deleteLegalEntity` (country immutable; deactivation 422 while any site is active; hard delete only with zero sites).
  - `listLegalEntities` — OWNER/ADMIN only, **includes inactive rows by default** (`?includeInactive=false` to hide, ruling 53).
  - `createSite` — one transaction: Site + seven opening-hour rows + system `TRANSIT` atomically; defaults derived from the legal entity country (AT → `Europe/Vienna`/`AT`; DE → `Europe/Berlin`/`DE`); 422 on an inactive legal entity; immutable `legal_entity_id` enforced. **No default `LOT` is auto-created for new sites** so a pristine created site remains hard-deletable (spec only mandates a default LOT during MAIN backfill when the tenant has none).
  - `updateSite` — name/address updates and reactivation (requires active parent); **`isActive=false` is rejected** until the serialized deactivation guard (ruling 41) lands with the SiteContext issue.
  - `deleteSite` — pristine-only; removes empty system transit location + hours/holiday config internally.
  - `listSites` — default names-only active directory requires an active `TenantMember` **and** at least one active `SiteMembership` (rulings 12/53); `includeInactive=true` is OWNER/ADMIN and returns full rows.
  - `getSite` — requires an active `SiteMembership` on that site OR OWNER/ADMIN (ruling 53).
  - `listSiteMemberships` — OWNER/ADMIN.
  - `addSiteMembership` (requires active `TenantMember` — service check + composite FK; 422 when inactive), `removeSiteMembership` (clears `active_site_id` atomically).
  - `resolveDefaultSiteId` / `resolveDefaultSite` — only ACTIVE sites; throws when the tenant has no active site so bay/location/purchase services never stamp into an inactive target.
  - `guardSiteDeactivation` — kept (stock qty + parked dealer vehicles) for the follow-up; not wired into `updateSite`.
- **`src/common/services/user-active-tenant.ts`** — `setActiveTenant` is the **only** production writer of `User.active_tenant_id` (ruling 11/50): it atomically sets `active_tenant_id` and `active_site_id = null`. Wired into `AuthSessionService.switchTenant`, `AuthSessionService.ensureActiveMembership`, `TenantMemberService` invite auto-assign, and `TenantMemberService.syncUserClaims`. A static guard test scans those files and rejects any direct `data: { active_tenant_id` write outside the helper.
- **`WorkshopSettingsService` rewritten** to be Site-backed; the `GET`/`PUT /api/workshop/settings` routes keep their shape and now read/write the tenant's MAIN Site (ruling 56). It lazily creates the LegalEntity+MAIN+system locations if a tenant has none.
- **`WorkshopHolidayService`, `WorkshopTaskService`, `EmployeeService`, `HrAttendanceService`** updated from tenant `WorkshopSettings` to site lookup.
- **`LocationService.remove`** now blocks system `in_transit` locations and lots with non-`SOLD` dealer vehicles (ruling 45); `BayService`/`LocationService`/`PurchaseService` stamp `site_id` on create.
- **Seed** creates the LegalEntity + MAIN Site + system locations and stamps `site_id` on warehouses.

### Tests

- `src/site/site.service.spec.ts` — 39 unit tests: creation validation (incl. DE defaults, atomic hours+TRANSIT, no auto-LOT), immutable `legal_entity_id`, read authorization (directory gate, getSite membership/OWNER-ADMIN, OWNER/ADMIN lists, legal-entities-include-inactive), deactivation rejection, reactivation, pristine delete, membership rules, `resolveDefaultSiteId` active-only, active-site clearing.
- `src/common/services/user-active-tenant.spec.ts` — static guard that the four `active_tenant_id` call sites route through `setActiveTenant` and that seed/test utilities pair `active_site_id` with `active_tenant_id` writes.
- `test/multi-location.e2e-spec.ts` — 18 e2e tests: cross-tenant composite FK rejection (site→legal entity, membership→tenant member, `active_site_id`→site, parent bin→site, **vehicle→lot**), system transit delete guard, lot delete guard (parked vs SOLD vehicle), site deactivation rejection + guard, read-authorization negative cases, create-to-delete lifecycle, all-inactive `resolveDefaultSiteId` failure, migration invariants (one MAIN site, one transit, seven opening hours).
- `apps/core-api/scripts/verify-multi-location-migration.sh` — standalone backfill verification covering: missing `WorkshopSettings`, `CH` and `US` holiday country fallback, partial opening-hour rows (filled to seven), inactive `TenantMember` (membership copied inactive), bay stamping, parked dealer vehicles remediated to `MAIN LOT`, the persisted-`ON_ORDER`-vehicle migration failure, and **failure-path verification** (schema/data unchanged + migration rerunnable after resolving the failed attempt).

## Deviations and scoped limitations

1. **`site_id` on operational documents deferred.** The spec's site-owned manifest lists `workshop_orders`, `sales_orders`, `purchase_orders`, `vehicle_purchases`, `vehicle_sales`, `inventory_transactions`. These are **not** stamped in this PR: there is no `SiteContextService` yet, and making the columns NOT NULL without a session site would break every create path. They arrive with the SiteContext/operational-split issue. Consequently the site deactivation guard does not yet check document terminal statuses (only stock + parked vehicles), and `site_id` is added to the **parent/bin/bay/location** and **settings/holiday** tables only — which is what the acceptance criteria require.
2. **Site deactivation (`PATCH /api/sites/:id` `isActive=false`) is rejected** until the serialized guard (ruling 41: site-row lock, recheck, coordinated locks in every targeting write, `active_site_id` clearing) lands with the SiteContext issue. `guardSiteDeactivation` remains as a helper for that follow-up.
3. **`workshop_settings` dropped in contract**, not kept until a later release. All values were copied to Site during backfill; `getOrCreateSettings` lazily recreates a MAIN site (with legal entity + system locations) if a tenant somehow has none, so legacy tenants keep working.
4. **Realtime:** `site_context_updated` / `site_access_scope_updated` events and site rooms are **not** implemented here — they are part of the SiteContext/session issue (rulings 9–11, 37). `StockTransfer` tables are likewise deferred.
5. **`User.active_site_id` writers routed through `setActiveTenant`.** The four `active_tenant_id` writers (`switchTenant`, `ensureActiveMembership`, invite auto-assign, `syncUserClaims`) all go through the shared helper, which atomically nulls `active_site_id`. Note: the migration backfill **sets** `active_site_id` to the tenant's MAIN site for users with an active membership (it does not null pre-existing values), so a user whose `active_tenant_id` is later changed through the helper gets the site cleared in the same write.
6. **`users (active_tenant_id, active_site_id) → sites` and `vehicles (tenant_id, location_id) → storage_locations (tenant_id, id)` are DB-only constraints, not Prisma relations.** `active_tenant_id` is already bound to the `Tenant` relation (and `Vehicle.tenant_id` to the `Tenant` relation), so Prisma cannot express these composites; the FKs are added in the contract migration and deliberately unmodeled. `prisma migrate deploy` (the CI convention) applies them; `prisma migrate dev` would offer to drop them. All other new FKs match Prisma's generated definitions (`ON UPDATE CASCADE`, exact names) so `prisma migrate diff` shows no drift on the new tables beyond these two documented constraints.
7. **`finance_settings.next_stock_transfer_number` / `stock_transfer_prefix`** (ruling 52) and all `StockTransfer` models are out of scope for this foundation issue and were not added.

## Follow-up issues to file

- SiteContextService + session site resolution; `GET /me/sites` and `PATCH /me/active-site` (rulings 7–9, 47).
- Serialized site deactivation (ruling 41) — rewire `updateSite isActive=false` to the guarded toggle + `active_site_id` clearing once documents carry `site_id`.
- Stamp `site_id` on site-owned documents; document site PATCH transitions (rulings 13–19).
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
