# QA Guide: Sites vs Storage Locations

Linear: [AUT-290](https://linear.app/auto-core-platform/issue/AUT-290/multi-location-clarify-sites-vs-storage-locations-enable-multi-site)

## Quick reference

| UI element | What it is | What it is **not** |
| --- | --- | --- |
| Sidebar **Current Tenant** card | `TenantSwitcher` — which workshop company (tenant) you belong to | A site switcher |
| Sidebar **Current Site** block | `SiteSwitcher` — which operational shop location your session is scoped to | A storage-bin picker |
| Settings → **Storage Locations** | Bins/warehouses **within** the active site (`StorageLocation` rows) | Proof of multi-site; city names here are warehouse labels, not separate sites |

Operational list pages (Inventory, Vehicle Stock, Workshop) are scoped to the **session active site** (`User.active_site_id`). There is no per-page site switcher by design (ADR-0022).

## Demo seed (multi-site E2E)

The `default-workshop` demo tenant seeds **two sites**:

| Code | Name | Storage tree |
| --- | --- | --- |
| `MAIN` | Vienna Workshop | Main Showroom, Tire Hotel (+ system TRANSIT/LOT) |
| `GRZ` | Graz Workshop | Workshop Storage, staging totes (+ system TRANSIT/LOT) |

`MAIN` is intentional: workshop settings and other legacy lookups still resolve the Vienna site by `code: 'MAIN'`.

QA users (`grok-bot@auto.core.at`, `grok-bot-tech@auto.core.at`, `testauto@auto.core.at`) receive `SiteMembership` on both sites when:

1. `npm --prefix apps/core-api run db:seed` runs (`seedDemoSiteAccess`), and/or
2. `npm --prefix apps/core-api run db:seed:tenant-member` runs (grants all active tenant sites).

With two site grants, the sidebar shows an interactive **Current Site** dropdown. With exactly one grant, the sidebar shows a read-only **Current Site: …** label (AUT-290).

## Within-site filtering

- **Inventory** (`/inventory`): optional **Storage Location** filter and **Storage Location** column filter stock within the active site only.
- **Vehicle Stock** (`/vehicle-stock`): list is site-scoped; bin-level `location_id` list filter is **not** implemented yet (BE query work required — see AUT-290 follow-up).

## Common QA mistakes

1. **"I see Vienna and Graz in Settings → Storage Locations, so we must be multi-site."**  
   Before AUT-290 those names were warehouses under a single `MAIN` site. After AUT-290 Vienna warehouses live under `MAIN` and Graz warehouses under `GRZ` — check the sidebar **Current Site** block, not Storage Locations alone.

2. **"Tenant still says Default Workshop."**  
   Correct. Tenant name does not change when you switch sites.

3. **"No site dropdown on Inventory."**  
   Site context is global in the sidebar. Inventory exposes **storage location** filtering within the active site, not site switching.

## Admin UI

OWNER/ADMIN can manage legal entities and site memberships under **Settings → Legal Entities** and **Settings → Sites** (wired to `/api/legal-entities` and `/api/sites`).

## Related specs

- `docs/internal/02-Feature-Specs/Platform/2026-08-31-multi-location-sites-and-legal-entities.md`
- `docs/tenant-admin-seeding.md`
