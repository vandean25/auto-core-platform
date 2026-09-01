## Summary

Schema and migration foundation for the approved Multi-Location Feature Spec (`docs/internal/02-Feature-Specs/Platform/2026-08-31-multi-location-sites-and-legal-entities.md`) and ADR-0022. Adds `LegalEntity`, `Site`, `SiteMembership`, `User.active_site_id`, site-safe composite FKs, system `in_transit` + default `LOT` locations, and an expand → backfill → validate → contract migration for existing tenants.

## Files

- `apps/core-api/prisma/schema.prisma` — new models, composite uniques/FKs, `LocationType.in_transit`, `storage_locations.is_system`, `Bay`/`StorageLocation` `site_id`, `WorkshopSettings` → per-site fields, `VehicleLot` `onDelete: Restrict`.
- `apps/core-api/prisma/migrations/20260831180000_add_in_transit_location_type/` — enum-only migration (PostgreSQL 55P04 constraint).
- `apps/core-api/prisma/migrations/20260901000000_multi_location_legal_entity_site/` — expand/backfill/validate/contract in one file.
- `apps/core-api/src/site/` — `SiteService`, controller, DTOs, module (global).
- `apps/core-api/src/workshop/workshop-settings.service.ts` + holiday/task/employee/hr consumers — rewritten to be Site-backed.
- `apps/core-api/src/bay/bay.service.ts`, `src/inventory/location.service.ts`, `src/purchase/purchase.service.ts`, `prisma/seed.ts` — stamp `site_id`; `LocationService.remove` guards system `in_transit` + parked-vehicle lots.
- `docs/deletion-policy.md` — already documents the new entities (updated in the spec/ADR PR; no change needed).
- `docs/internal/02-Feature-Specs/Platform/IMPLEMENTATION-NOTES-AUT-252.md` — deviations + follow-up issues.
- Tests: `src/site/site.service.spec.ts`, `test/multi-location.e2e-spec.ts`, `scripts/verify-multi-location-migration.sh`.

## Acceptance criteria → implementation

| Criterion | Implementation |
|---|---|
| Existing single-site tenants migrate without data loss and have one active usable MAIN Site | Backfill creates one `LegalEntity` + one `MAIN` `Site` per tenant; defaults for missing `WorkshopSettings`; verified by `verify-multi-location-migration.sh` and e2e invariant tests |
| Prisma relations prevent cross-tenant and cross-site parent/bin/bay/location references | Composite FKs `(tenant_id, site_id, …)` on `bays`, `storage_locations` (incl. `parent_id`), opening hours, holidays; e2e rejects cross-tenant legal entity / membership / `active_site_id` / parent-bin |
| Every non-null site-owned backfill value is validated before NOT NULL/contract constraints | VALIDATE phase asserts zero un-stamped bays/locations, zero parked vehicles without a lot, zero persisted `ON_ORDER`, valid `active_site_id`; contract then sets NOT NULL |
| Site hard-delete/deactivation and transit/lot guards match the deletion policy | `SiteService.guardSiteDeactivation` (stock + parked vehicles), pristine-only hard delete with internal removal of hours/holidays + empty system transit, `LocationService.remove` blocks `is_system` and parked-vehicle lots, `VehicleLot` `onDelete: Restrict` |
| Migration coverage: missing `WorkshopSettings`, partial opening-hour rows, CH/US holiday country, inactive `TenantMember`, malformed parked dealer vehicle fixtures | All covered in `verify-multi-location-migration.sh` (Tenant A no settings, Tenant B CH + partial hours + inactive member, Tenant C US + parked vehicles without location, ON_ORDER failure) |
| `prisma generate`, `prisma migrate deploy`, tenant-scope lint, unit + E2E suite pass | See Verification below |

## Verification

- `prisma generate` — passed
- `prisma migrate deploy` on clean unseeded DB — passed
- `prisma migrate deploy` on pre-seeded legacy fixture — passed
- `prisma db seed` on fresh migrated DB — passed
- `lint:prisma-tenant` — passed
- ESLint (`src`, `test`) — passed
- `tsc -p tsconfig.build.json` — passed
- Unit: 940 passed / 123 suites
- E2E: 282 passed / 39 suites (fresh DB)

## Scoped limitations (details in IMPLEMENTATION-NOTES-AUT-252.md)

- `site_id` on operational documents (`workshop_orders`, `sales_orders`, etc.) deferred to the SiteContext issue; document-terminal checks in the deactivation guard follow.
- Ruling-41 serialized deactivation (typed row lock) deferred; AUT-65 bans the raw `$executeRaw` lock.
- `users (active_tenant_id, active_site_id) → sites` is a DB-only constraint (Prisma cannot model it; `active_tenant_id` is already bound to `Tenant`).
- Tenant-change helper for the four `active_tenant_id` writers, realtime site events, and `StockTransfer` tables are follow-ups.

Built for [Dejan Dosenovic](https://linear.app/auto-core-platform/issue/AUT-252/multi-location-add-legalentity-site-sitemembership-and-safe-backfill#agent-session-0a4d741f) by [Kilo](https://kilo.ai)
