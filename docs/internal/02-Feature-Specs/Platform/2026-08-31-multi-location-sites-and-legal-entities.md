---
title: "Multi-Location Sites and Legal Entities"
date: "2026-08-31"
module: "Platform"
status: draft
linear-project: ""
linear-milestone: ""
tags:
  - feature-spec
  - platform
  - site
  - legal-entity
  - inventory
  - workshop
---

# Multi-Location Sites and Legal Entities

## Summary

ACP is a multi-tenant workshop ERP whose security boundary is `tenant_id` (ADR-0013). This spec adds an **operational** boundary inside a tenant: a shop can run **several physical sites** (Wien, München) that belong to **several legal entities** (AT GmbH, DE GmbH), N:1 (many sites per GmbH).

Slice 1 splits **planner and stock** by site, adds a current-site switcher, and adds **same-GmbH stock transfers** (request → approve → ship → receive). Catalog, customers, employees, vendors, revenue groups, brands, and finance settings stay tenant-wide. HR is not site-owned.

**Legal Invoicing & Accounting Export is paused.** DACH Rechnung fields, credit notes, and DATEV/BMD hang off `document.site → legal_entity` after this spec lands. Cross-GmbH (intercompany) stock moves wait on that work. E-invoice (ZUGFeRD / XRechnung) stays a later slice of invoicing, not of this spec.

Architecture: [ADR-0022](../../01-ADR/2026-08-31-site-operational-scope.md).

---

## Approaches considered

| Approach | What it is | Verdict |
|----------|------------|---------|
| **A+. Site as authenticated request context** | `LegalEntity` + `Site` + `SiteMembership`. `User.active_site_id`. Operational APIs use `SiteContextService`. Prisma tenant extension unchanged. Documents persist `site_id`. | **Chosen.** |
| **B. Site inside the Prisma tenant extension** | Auto-filter `site_id` like `tenant_id`. | **Rejected.** Shared master data needs a growing bypass list. |
| **C. `?siteId=` on every list** | Client filter is authorization. | **Rejected.** A missing parameter exposes another site’s operational data. |
| **Full multi-location ERP in one spec** | Bays, stock, HR, intercompany invoices, DATEV. | **Rejected.** Destination architecture, not this slice. |
| **1:1 site = GmbH** | One row is both workshop and company. | **Rejected.** N:1 is the general model; Wien/München with one site each is just N:1 with n=1. |

---

## User Stories

- As an **Owner**, I want **several sites under one tenant** so that **Wien and München do not share a planner or a warehouse**.
- As an **Owner**, I want **several legal entities** so that **each site issues (later) under the correct GmbH**, and **stock transfers cannot cross GmbHs**.
- As a **User who works both shops**, I want a **current-site switcher** so that **the board and ATP are one shop at a time**, without a second login.
- As a **Service Advisor**, I want **a booking I created on the wrong calendar to move until intake** so that **I do not delete and recreate the job**.
- As a **Parts clerk**, I want **to request parts from a sister site in the same GmbH** so that **stock can move with a proper ship/receive**, including partial receipt.
- As a **München clerk without Wien membership**, I want **to request from Wien without seeing Wien bins** so that **the source shop picks the bin when they approve or ship**.

---

## Product rulings (binding)

### Boundaries

1. **`tenant_id`** is the customer-security boundary. ADR-0013 and the Prisma tenant extension stay unchanged. Every new model is tenant-scoped. Composite tenant-safe relations: a site cannot reference another tenant’s legal entity; a document cannot reference another site’s bay, bin, or lot.
2. **`site_id`** is operational ownership and visibility inside that customer. It is **not** a second RLS key in Prisma `$extends`.
3. **`legal_entity_id`** is the future fiscal/accounting boundary. Slice 1 stores a thin entity (name, country `AT` \| `DE`, `is_active`) so transfers can require the same GmbH. No Steuernummer, UID, IBAN, or invoice number series here.
4. **`Site.legal_entity_id` is immutable** after insert. Changing GmbH would silently rewrite historical transfers and future invoice issuer resolution.

### Membership vs employees

5. **`SiteMembership`** controls which users may activate a site. It does **not** make `Employee` site-owned. Employees, attendance, and leave stay tenant-wide (ADR-0020).
6. **`OWNER` / `ADMIN`** come from `TenantMember`. `SiteMembership` is access-only (no per-site role column in slice 1).

### Session and SiteContext

7. **`User.active_site_id`** is the session site. `SiteContextService` loads it and validates: active tenant, site belongs to that tenant, site `is_active`, active `SiteMembership`. Operational APIs call `siteContext.getSiteId()` — never `?siteId=` or `X-Site-Id`. Sending `siteId` as a list filter on an operational endpoint is **400**.
8. **`422 ACTIVE_SITE_REQUIRED`** only from **site-dependent operational APIs**. Tenant-wide APIs, `GET /me/sites`, and `PATCH /me/active-site` remain usable so the user can recover. Switching **never auto-selects** another site.
9. **`PATCH /me/active-site`** transactionally validates tenant, site, active membership, and site activity, then updates the user. Success emits **`site_context_updated`** on that user’s private socket room with `{ siteId }` (or `null` when cleared). The room identity is the existing gateway prefix **`user_{firebaseUid}`** (`DashboardGateway.USER_ROOM_PREFIX`). `AuthenticatedUser.userId` and `socket.data.userId` are already the Firebase UID (`auth-session.service.ts` `buildSession`). **Do not** emit to `user_{User.id}` — `SiteMembership.user_id` is the relational UUID and that room has no sockets. **Every** socket for that user must leave the previous site room and join the new one (or no site room). Tenant-wide caches stay valid. The initiating tab is not special.
10. Removing a `SiteMembership` that matches `User.active_site_id` **clears `active_site_id` atomically** (null) and emits `site_context_updated` (`siteId: null`). Deactivating the user’s active site does likewise. The user gets `ACTIVE_SITE_REQUIRED` on the next operational call until they PATCH a remaining site. **Any** membership grant, revoke, or deactivate — including a site that is **not** `active_site_id` — also emits **`site_access_scope_updated`** on `user_{firebaseUid}` so cached `GET /api/stock-transfers`, `GET /api/sites`, and `GET /me/sites` results are dropped. Resolve `User.firebaseUid` from `SiteMembership.user_id` before emit.
11. **`POST /api/auth/switch-tenant`** (`AuthController.switchTenant`; frontend `fetchWithAuth('/api/auth/switch-tenant')`) currently updates `active_tenant_id` alone. After the composite FK `(active_tenant_id, active_site_id) → sites(tenant_id, id)`, leftover `active_site_id` from the previous tenant violates the constraint. The switch **must** atomically set `active_tenant_id` **and** set `active_site_id = null`. Never auto-pick a site in the destination tenant. Emit `site_context_updated` with `siteId: null` to every socket in `user_{firebaseUid}` (in addition to the existing `auth:claims_updated`). Clients leave the old site room and invalidate site-scoped caches. Recovery: `GET /me/sites` then `PATCH /me/active-site`.
12. Named cross-site methods (`listAcrossAuthorizedSites()`, transfer APIs) derive permitted **operational** site IDs **only** from the caller’s active `SiteMembership` rows. They never accept an unrestricted caller-provided list. No generic “bypass site filtering” flag. **Exception — site directory (names only):** any user with at least one active `SiteMembership` may list active sites in the current tenant as `{ id, code, name, legalEntityId }` so a dest-only requester can name `from_site_id`. That directory **must not** include on-hand, bins, bays, or orders. Source locations remain from-site membership only.

### Document site ownership

13. **Create** stamps `site_id = SiteContext.getSiteId()`. After create, **never infer** the document’s site from the user’s current switcher. Read `document.site_id`.
14. **Site PATCH is a guarded atomic transition** (ADR-0011 style). **Every** document site change requires an **active `SiteMembership` on the target site** (workshop, sales, purchase order, vehicle purchase, vehicle sale). Names-only directory IDs are not authorization. Stale status/site → **409**. Past the permitted boundary → **422**. The site-change write and the commit transition cannot race: one guarded transaction wins.
15. **WorkshopOrder:** site change allowed only while `SCHEDULED`. Atomically retarget: `bay_id` must be a bay of the target site (required; 422 if omitted or still a source-site bay). Clear or revalidate any reservations, kits, and staging bin so none remain on the source site. Frozen from `INTAKE`.
16. **SalesOrder:** site change allowed only while `DRAFT`. Frozen at `CONFIRMED` (and after).
17. **VehiclePurchase:** site change allowed only while `DRAFT`. Destination lot must belong to the target site. Frozen at `RECEIVED`.
18. **VehicleSale:** site change allowed only while `DRAFT`. The parked vehicle must **already** belong to the target site (lot’s `site_id`). Otherwise the caller moves the vehicle first; a document-site edit is not a vehicle transfer. Frozen at `INVOICED`. `CANCELLED` stays frozen.
19. **PurchaseOrder** is site-owned (receive lands in that site’s locations). Same draft-then-freeze as sales: editable while `DRAFT`, frozen when the PO leaves `DRAFT`.

### Planner and stock

20. **Bays, opening hours, holidays, timezone, slot length** are per site. Tenant singleton `WorkshopSettings` is replaced: those fields live on `Site`; `WorkshopOpeningHour` / `WorkshopHoliday` FK to `Site`.
21. **Every `StorageLocation` belongs to exactly one site.** ATP, kitting, and on-hand lists use locations of the current site only. Tote / staging locations cannot be another site’s.
22. **`InventoryStock.site_id` is not independently writable.** Stock is site-scoped through `StorageLocation.site_id`. If denormalized for query performance, it is mechanically derived and protected against disagreement with the location.
23. **Same-site bin→tote** stays an instant `TRANSFER_OUT` + `TRANSFER_IN` pair (ADR-0002 / kitting). That is **not** a `StockTransfer` document.
24. **No shared pool.** ATP must not see another site’s on-hand.

### Transfers (same GmbH only)

25. **`StockTransfer`** is a document with immutable `from_site_id` and `to_site_id` (must differ). Both sites must share `legal_entity_id` at **create, approve, and ship**. Cross-GmbH → **422**. Intercompany sale is Legal Invoicing, not this spec.
26. **Requester membership is on either endpoint**, not both. A destination-only user may create a request naming `from_site_id` + qty, and **must not** inspect or set a source bin. Source membership selects `source_location_id` at **approve or ship**. If the requester also has from-site membership, they may suggest a source bin at create. **Create UX:** From-site picker is the names-only directory (`GET /api/sites`), not memberships-only. To-site picker defaults to the current site and also uses the directory so a from-only clerk can name dest. Submit **422** unless the caller has active membership on from **or** to. Source-bin field is omitted unless the caller has from-site membership.
27. **Line qty columns:** `requested_qty`, `approved_qty`, `shipped_qty`, `received_qty`, `returned_qty`. Enforce `received_qty + returned_qty ≤ shipped_qty` atomically. `approved_qty ≤ requested_qty`.
28. **Each line copies immutable `from_site_id` / `to_site_id` from the parent at create.** Composite FKs prove source bin belongs to from-site and dest bin belongs to to-site (see Database Impact). Service-only checks are not sufficient.
29. **States:** `REQUESTED` → `APPROVED` → `SHIPPED` → `COMPLETED`. Also `REJECTED` (from `REQUESTED`), `CANCELLED` (from `REQUESTED` or `APPROVED` only — no ledger yet). **Ship is one-shot and full:** `APPROVED → SHIPPED` happens once. The ship action must set `shipped_qty = approved_qty` on **every** line, require `source_location_id` on every line, and include at least one line with `approved_qty > 0`. Partial ship is out of scope (no remaining-to-ship, no second ship). Partial **receipt** leaves the document `SHIPPED`. When outstanding shipped qty is zero (`received + returned = shipped` on every line), the document becomes **`COMPLETED`**. Do not call a mixed receive/return `RECEIVED`.
30. **Receive and return** require **both** `expectedVersion` and `idempotencyKey`. Lookup the durable command row **before** OCC: same `(tenant_id, transfer_id, action, idempotency_key)` + same request hash returns the stored first result (no second ledger write), even if `version` has since incremented. Same key, different body hash → **409**. Missing row + stale `expectedVersion` → **409**. Persist the command row **atomically** with qty counters and ledger pairs (table below). In-memory keys are not enough for multi-instance Cloud Run. Approve/reject/cancel/ship use `expectedVersion` only (no ledger partials).
31. **Destination bin is frozen on first receive.** `StockTransferLine` has one `dest_location_id`. The first successful receive that writes it locks that bin. Every later partial receive for that line must send the **same** `destLocationId` → **422** on mismatch. Slice 1 does not persist per-receipt destination allocations.
32. **Authz:**
    - Request: active membership on **to** or **from**.
    - Approve / reject: active membership on **from** and `TenantMember` `OWNER`/`ADMIN`.
    - Ship: active membership on **from**.
    - Receive: active membership on **to**.
    - Return-unreceived: membership on **to**, or **from** `OWNER`/`ADMIN`.
33. **Ship availability** is atomic against `on_hand - reserved` at the source location, under the established stock locking order (ADR-0021: globally sorted ids, `SELECT … FOR UPDATE`). Reserved kit qty cannot ship.
34. **In-transit:** each site has one system location `type = in_transit`, `code` deterministic (e.g. `TRANSIT`). Non-selectable, non-deletable, non-disableable; excluded from normal location lists and from ATP/kitting. Ship: `TRANSFER_OUT` source bin + `TRANSFER_IN` from-site in-transit; both rows `site_id = from_site_id`. Receive: `TRANSFER_OUT` from-site in-transit + `TRANSFER_IN` dest bin (`site_id = to_site_id`). Return: from-site in-transit back to the **original source bin**. That bin cannot be disabled or soft-deleted while transfer qty remains outstanding.
35. **Every movement pair** has a unique `movement_group_id` in addition to `reference_id` = transfer id, so partial receipts reconcile. **Cost basis** follows the stock through in-transit, receipt, and return (copy; do not re-read live catalog).
36. Transfer mutations **publish to both endpoint site rooms** and to **`user_{firebaseUid}` of every user** with an active `SiteMembership` on from or to. Resolve Firebase UID from `SiteMembership.user_id` → `User.firebaseUid`; emitting to the relational UUID reaches no socket. That keeps the cross-site transfer list current for a Salzburg-active user who also belongs to Wien. Do **not** join all membership site rooms on the operational board (that would mix Wien planner events into a Salzburg session).

### Realtime

37. Isolation is **server-side site rooms**, not client-side filtering. On connect: join `site:{siteId}` for the active site (if any) and `user_{firebaseUid}`. Stay in the tenant room. Operational entity events emit to the document’s site room. Tenant-wide entities emit to the tenant room only. `site_context_updated` on the user room is how a second tab learns the switch; `site_access_scope_updated` is how a second tab learns a membership change that did not clear the active site.

### Deletion

38. Normal `LegalEntity` / `Site` removal is **deactivation** (`is_active = false`). **`PATCH /api/sites/:id` `is_active=false` is 422** while any of the following exist for that site: a `StockTransfer` in `REQUESTED`, `APPROVED`, or `SHIPPED` (as from or to); a non-terminal site-owned document (workshop not `INVOICED`/`CANCELLED`; sales/PO/vehicle not in a terminal status); on-hand, reserved, or in-transit quantity at any of the site’s locations. OWNER/ADMIN must complete, cancel, or move that work first. Slice 1 has **no** privileged “deactivate anyway / read-only completion” path. **`PATCH /api/legal-entities/:id` `is_active=false` is 422** while the entity has any `Site` with `is_active = true`. When site deactivation is allowed, clear `active_site_id` for users whose active site is this site and emit `site_context_updated` (`siteId: null`) plus `site_access_scope_updated`. Hard delete only for unused setup mistakes (see `docs/deletion-policy.md`). Pristine site hard-delete may internally remove its empty system transit location and hours/holiday config; that location remains forbidden from **direct** deletion APIs.
39. Site hard-delete checks **transfers, ledger history, storage locations, memberships, bays, and every site-owned document** — not only stock and bays.

---

## Database Impact

### New tables

| Table | Column | Type | Nullable | Notes |
|-------|--------|------|----------|-------|
| `legal_entities` | `id` | uuid | no | PK. Also unique `(tenant_id, id)` |
| | `tenant_id` | uuid | no | Tenant-safe |
| | `name` | string | no | |
| | `country_iso` | `AT` \| `DE` | no | Slice 1 DACH only |
| | `is_active` | boolean | no | default true |
| `sites` | `id` | uuid | no | PK. Also unique `(tenant_id, id)` |
| | `tenant_id` | uuid | no | |
| | `legal_entity_id` | uuid | no | **Immutable** after insert. Composite FK `(tenant_id, legal_entity_id)` |
| | `code` | string | no | Unique per tenant. Seed `MAIN` |
| | `name` | string | no | |
| | `address_street`, `address_city`, `address_zip`, `address_country` | string | yes | Nullable when no trustworthy source |
| | `timezone` | string | no | From existing `WorkshopSettings.timezone` |
| | `slot_minutes` | int | no | From workshop settings |
| | `holiday_country_iso` | string | no | |
| | `holiday_subdivision_code` | string | yes | |
| | `is_active` | boolean | no | default true |
| `site_memberships` | `id` | uuid | no | |
| | `tenant_id` | uuid | no | |
| | `user_id` | uuid | no | |
| | `site_id` | uuid | no | Composite tenant+site FK |
| | `is_active` | boolean | no | Preserve `TenantMember.is_active` on backfill |
| | | | | Unique `(tenant_id, user_id, site_id)` |
| `stock_transfers` | `id` | uuid | no | PK. Also unique `(tenant_id, id)` |
| | `tenant_id` | uuid | no | |
| | `transfer_number` | string | no | Unique per tenant. `TR-{YYYY}-{XXXX}` |
| | `from_site_id`, `to_site_id` | uuid | no | Immutable, must differ, composite site FKs |
| | `status` | enum | no | see rulings |
| | `version` | int | no | OCC for partial receive/return; start at 1 |
| | `requested_by_user_id` | uuid | no | |
| `stock_transfer_lines` | `id` | uuid | no | |
| | `tenant_id` | uuid | no | |
| | `transfer_id` | uuid | no | Composite FK `(tenant_id, transfer_id) → stock_transfers (tenant_id, id)` |
| | `from_site_id`, `to_site_id` | uuid | no | Copied from parent at create; immutable |
| | `catalog_item_id` | uuid | no | |
| | `source_location_id` | uuid | yes | Null until source membership sets it. When set: `(tenant_id, from_site_id, source_location_id) → storage_locations (tenant_id, site_id, id)` |
| | `dest_location_id` | uuid | yes | Frozen on first receive; later receives must match. When set: `(tenant_id, to_site_id, dest_location_id) → storage_locations (tenant_id, site_id, id)` |
| | `requested_qty`, `approved_qty`, `shipped_qty`, `received_qty`, `returned_qty` | Decimal(10,3) | no | Defaults 0 except requested |
| `stock_transfer_commands` | `id` | uuid | no | Durable receive/return idempotency |
| | `tenant_id` | uuid | no | |
| | `transfer_id` | uuid | no | Composite FK `(tenant_id, transfer_id) → stock_transfers (tenant_id, id)` |
| | `action` | `RECEIVE` \| `RETURN` | no | |
| | `idempotency_key` | string | no | Caller-supplied |
| | `request_hash` | string | no | Canonical hash of the request body (including line ids/qtys/dest bins; including `expectedVersion`) |
| | `response_status` | int | no | HTTP status of the first outcome |
| | `response_body` | jsonb | no | Stored first result |
| `inventory_transactions` | `movement_group_id` | uuid | yes | Required on transfer ship/receive/return pairs |
| | `site_id` | uuid | no after contract | Site of the location at post time |
| | `stock_transfer_id` | uuid | yes | Composite FK `(tenant_id, stock_transfer_id) → stock_transfers (tenant_id, id)` |

Uniques required for composite FKs (Prisma cannot reference a tuple that is not unique):

- `legal_entities (tenant_id, id)` and `(tenant_id, name)`
- `sites (tenant_id, id)` and `(tenant_id, code)`
- `bays (tenant_id, site_id, id)` and `(tenant_id, site_id, name)`
- `storage_locations (tenant_id, site_id, id)` and `(tenant_id, site_id, code)`
- `site_memberships (tenant_id, user_id, site_id)`
- `stock_transfers (tenant_id, id)`, `(tenant_id, transfer_number)`, and `(tenant_id, id, from_site_id, to_site_id)` (parent tuple so lines can FK the copied site ids)
- `stock_transfer_commands (tenant_id, transfer_id, action, idempotency_key)`

Child FKs that those uniques enable:

- `sites.legal_entity_id`: `(tenant_id, legal_entity_id) → legal_entities (tenant_id, id)`
- Workshop order `bay_id` / staging location: `(tenant_id, site_id, bay_id) → bays (tenant_id, site_id, id)` (same pattern for storage locations)
- `stock_transfer_lines`: `(tenant_id, transfer_id) → stock_transfers (tenant_id, id)` **and** `(tenant_id, transfer_id, from_site_id, to_site_id) → stock_transfers (tenant_id, id, from_site_id, to_site_id)`
- `stock_transfer_lines.source_location_id` (when not null): `(tenant_id, from_site_id, source_location_id) → storage_locations (tenant_id, site_id, id)`
- `stock_transfer_lines.dest_location_id` (when not null): `(tenant_id, to_site_id, dest_location_id) → storage_locations (tenant_id, site_id, id)`
- `stock_transfer_commands.transfer_id`: `(tenant_id, transfer_id) → stock_transfers (tenant_id, id)`
- `inventory_transactions.stock_transfer_id` (when not null): `(tenant_id, stock_transfer_id) → stock_transfers (tenant_id, id)`
- `User.active_site_id`: composite `(active_tenant_id, active_site_id) → sites (tenant_id, id)` so a site cannot be the active site for another tenant. When `active_site_id` is null (recovery, revoked membership, tenant switch), the FK is not applied.

Indexes: every site-owned table `(tenant_id, site_id)` (transfers: `(tenant_id, from_site_id)` and `(tenant_id, to_site_id)`). `stock_transfer_commands (tenant_id, transfer_id)`.

### Modified tables

| Table | Change | Migration |
|-------|--------|-----------|
| `users` | `active_site_id` nullable; composite FK `(active_tenant_id, active_site_id) → sites(tenant_id, id)` | Yes |
| `bays` | `site_id` NOT NULL after contract; unique `(tenant_id, site_id, name)` | Yes |
| `storage_locations` | `site_id` NOT NULL; unique `(tenant_id, site_id, code)`; new `LocationType.in_transit` | Yes |
| `workshop_orders` | `site_id` NOT NULL; bay/staging composite site-safe FKs | Yes |
| `sales_orders` | `site_id` NOT NULL | Yes |
| `purchase_orders` | `site_id` NOT NULL | Yes |
| `vehicle_purchases` | `site_id` NOT NULL; lot site-safe | Yes |
| `vehicle_sales` | `site_id` NOT NULL | Yes |
| `inventory_transactions` | `site_id` NOT NULL; `movement_group_id`; optional `stock_transfer_id` with composite FK `(tenant_id, stock_transfer_id) → stock_transfers (tenant_id, id)` | Yes |
| `inventory_stocks` | optional denormalized `site_id` generated/maintained from location — **not** independently writable | Optional |
| `workshop_opening_hours` | FK to `site` instead of tenant `WorkshopSettings`; unique `(tenant_id, site_id, weekday)` | Yes |
| `workshop_holidays` | FK to `site` | Yes |
| `workshop_settings` | **Removed** after backfill (fields live on `Site`) | Yes |

### Site-owned migration manifest

Expand / backfill / validate / contract. Maintain this list in the migration. Backfill each row. **Assert zero missing or mismatched `site_id`**, then `NOT NULL` and composite FKs.

`bays`, `storage_locations`, `workshop_orders`, `sales_orders`, `purchase_orders`, `vehicle_purchases`, `vehicle_sales`, `inventory_transactions`, `workshop_opening_hours`, `workshop_holidays`.

Parent-derived (no independent writable `site_id` unless denormalized and protected): `inventory_stocks` via location; `workshop_tasks` via order; parked `vehicles` via lot.

Tenant-wide (no `site_id`): `catalog_items`, `customers`, `revenue_groups`, `brands`, `vendors`, `employees`, `labor_*`, `finance_settings`, `invoices` (issuer snapshot is Legal Invoicing).

### Backfill rules

- One `LegalEntity` per existing tenant: `name = Tenant.name`, `country_iso` from `WorkshopSettings.holiday_country_iso` when that row exists, else **`AT`**.
- One `Site`: `code = MAIN`, name from tenant, **nullable address**. Timezone / slot / holiday country from `WorkshopSettings` when present, else **`Europe/Vienna`**, **`30`**, **`AT`** (`holiday_subdivision_code` null). `WorkshopSettings` is created lazily today; missing row must not fail the contract.
- One system `in_transit` location per site.
- Opening hours: copy existing weekday rows when present; otherwise insert **`DEFAULT_OPENING_HOURS`** from `apps/core-api/src/workshop/workshop-hours.defaults.ts` — Mon–Fri `07:30`–`17:00`, Saturday `08:00`–`12:00`, Sunday closed (times still stored when closed). Do **not** backfill every day as open `07:30`–`17:00`. Copy holidays when present.
- `SiteMembership` for **every** `TenantMember`, `is_active` copied from the membership.
- Set `User.active_site_id` **only** when that user’s `active_tenant_id` is this tenant **and** they have an active `TenantMember` there. Users without a valid active tenant membership remain `null`. The composite FK must hold.

### Deletion Policy Impact

Update `docs/deletion-policy.md` (this PR). See ADR-0005.

---

## API Contract Changes

### New endpoints

| Method | Route | Request | Response | Auth |
|--------|-------|---------|----------|------|
| GET | `/api/me/sites` | — | Sites the user has active membership on (current tenant) | session |
| PATCH | `/api/me/active-site` | `{ siteId }` | `{ activeSiteId }` | session; validates membership |
| GET/POST | `/api/legal-entities` | create: name, country | list/create | OWNER/ADMIN |
| PATCH | `/api/legal-entities/:id` | name, `is_active` | entity | OWNER/ADMIN. `country_iso` immutable after create. `is_active=false` **422** while any site of the entity is active. |
| GET | `/api/sites` | — | Directory: `{ id, code, name, legalEntityId }` for active sites in the tenant. No bins, stock, or orders. | Any user with ≥1 active `SiteMembership` |
| GET | `/api/sites/:id` | — | Full site (hours, address) if membership **or** OWNER/ADMIN | |
| POST | `/api/sites` | legalEntityId, code, name, address, hours | site | OWNER/ADMIN |
| PATCH | `/api/sites/:id` | name, address, hours, `is_active` | site | OWNER/ADMIN; **not** `legalEntityId`. `is_active=false` **422** while open transfers, non-terminal site-owned documents, or on-hand/reserved/in-transit qty remain. |
| POST/DELETE | `/api/sites/:id/memberships` | `{ userId }` | membership | OWNER/ADMIN |
| GET | `/api/stock-transfers` | — | transfers where caller has membership on from **or** to | named cross-site |
| POST | `/api/stock-transfers` | `fromSiteId`, `toSiteId`, lines (`catalogItemId`, `requestedQty`, optional `sourceLocationId` if from-member) | transfer `REQUESTED` | membership on from or to |
| POST | `/api/stock-transfers/:id/approve` | `{ expectedVersion, lines?: [{ id, approvedQty, sourceLocationId? }] }` | `APPROVED`. Omitted `approvedQty` defaults to `requested_qty`. `sourceLocationId` may be set here if still null. | from + OWNER/ADMIN |
| POST | `/api/stock-transfers/:id/reject` | `{ expectedVersion }` | `REJECTED` | from + OWNER/ADMIN |
| POST | `/api/stock-transfers/:id/cancel` | `{ expectedVersion }` | `CANCELLED` | requester or from OWNER/ADMIN; only REQUESTED/APPROVED |
| POST | `/api/stock-transfers/:id/ship` | `{ expectedVersion, lines: [{ id, sourceLocationId }] }` | `SHIPPED`. Ships **full** `approved_qty` on every line. 422 if any `shipQty` would be partial or a line is omitted. | from membership |
| POST | `/api/stock-transfers/:id/receive` | `{ expectedVersion, idempotencyKey, lines: [{ id, receiveQty, destLocationId }] }` | `SHIPPED` or `COMPLETED` | to membership. First receive freezes `dest_location_id`; later `destLocationId` must match. |
| POST | `/api/stock-transfers/:id/return` | `{ expectedVersion, idempotencyKey, lines: [{ id, returnQty }] }` | `SHIPPED` or `COMPLETED` | to, or from OWNER/ADMIN |

### Modified endpoints

| Method | Route | Change |
|--------|-------|--------|
| Operational lists/creates (planner, board, bays, stock, ATP, workshop/sales/vehicle/PO) | Scope to `SiteContext.getSiteId()`. Reject `siteId` query. `422 ACTIVE_SITE_REQUIRED` when active site missing/invalid. |
| PATCH workshop/sales/vehicle/PO | Site change only inside the state machine; **target membership required**; 409 stale; 422 past boundary; atomic retarget. |
| `GET /api/workshop/settings` (or replacement) | Read/write **current site** hours/timezone, not a tenant singleton. |
| `POST /api/auth/switch-tenant` | Atomically set `active_tenant_id` and **`active_site_id = null`**. Never auto-pick. Emit `site_context_updated` `{ siteId: null }` to `user_{firebaseUid}` plus existing `auth:claims_updated`. |

### OpenAPI Regeneration

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

### Layout & Actions

- [ ] Page-level actions top-right; title/breadcrumbs top-left.
- [ ] `text-2xl font-semibold tracking-tight` headers; subtitle `text-slate-500`.

### Site switcher

- Header control: current site name, dropdown of `GET /me/sites`. Hidden in chrome when the user has **exactly one** active membership (recovery APIs still exist).
- After switch: `site_context_updated` on `user_{firebaseUid}` drives **all** tabs to leave/join site rooms and invalidate site-scoped TanStack keys. Catalog/customer/employee queries stay.
- After **tenant** switch: same event with `siteId: null`; site switcher empty until the user picks a site in the new tenant.

### Settings

- OWNER/ADMIN: Legal entities, sites, memberships (tenant-wide settings area). Hours/holidays edited on the **site** (or settings scoped to the active site).
- Deactivate Site / Legal Entity controls must surface the 422 guard (open transfers, stock, active sites) rather than silently toggling.

### Transfers

- List: transfers touching any site the user belongs to. Invalidated via **`user_{firebaseUid}`** transfer events **and** `site_access_scope_updated` on membership revoke (including non-active sites). Do not join every membership’s site room.
- Create: **From-site** = names-only directory (`GET /api/sites`). **To-site** = directory, default current site. Source-bin field omitted unless the caller has from-site membership. Memberships-only pickers are forbidden (they hide Wien from a München-only clerk).
- Receive/return: qty fields; document stays Shipped until complete. Destination bin locked after the first receive on that line.

### List Pages

- [ ] Create button `+ Site`, `+ Legal entity`, `+ Transfer`.
- [ ] DataTable search/sort; `StatusBadge`; row click → detail.

### Form Handling

- [ ] Site/legal-entity master data: auto-save (750 ms) or save-on-blur per existing settings patterns.
- [ ] Transfer actions are explicit POSTs (not auto-save).

### Real-Time Sync

- [ ] `STOCK_TRANSFER` added to `SUPPORTED_ENTITY_TYPES`.
- [ ] Operational types emit to **site rooms**; payload includes `siteId`. Transfers emit to **both site rooms** and to **`user_{firebaseUid}`** of members of from or to (resolved from `User.firebaseUid`, not `User.id`).
- [ ] `site_context_updated` on `user_{firebaseUid}`; second-tab switch/revoke/tenant-switch covered.
- [ ] `site_access_scope_updated` on any membership revoke, including a site that is not `active_site_id`.
- [ ] Tenant-wide types stay on the tenant room.

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `SiteSwitcher` | header chrome | `GET /me/sites`, `PATCH /me/active-site` |
| `LegalEntitySettingsTab` | settings | CRUD legal entities |
| `SiteSettingsTab` | settings | CRUD sites, hours, memberships |
| `StockTransferListPage` | inventory or logistics | Cross-site list |
| `StockTransferDetailPage` | same | Request/approve/ship/receive/return |

---

## Testing Plan

### Backend E2E

- [ ] Migration verification: zero missing/mismatched `site_id` on the manifest; contract NOT NULL succeeds.
- [ ] Seeded single-site tenant: operational APIs work with `MAIN`; switcher chrome not required.
- [ ] `ACTIVE_SITE_REQUIRED` on operational GET; `GET /me/sites` and `PATCH /me/active-site` still 200.
- [ ] PATCH active-site rejects other-tenant site, inactive site, and missing membership.
- [ ] `POST /api/auth/switch-tenant` atomically nulls `active_site_id`; does not auto-pick a dest-tenant site; leftover previous-tenant site would violate the composite FK. Emits `site_context_updated` `{ siteId: null }` to `user_{firebaseUid}`.
- [ ] Membership revoke that matches `active_site_id` nulls it atomically.
- [ ] Membership revoke of a **non-active** site still emits `site_access_scope_updated` (transfer list / directory caches drop).
- [ ] Tenant-wide catalog/customer remain visible after a site switch.
- [ ] Cross-site: Wien planner does not return München orders; Wien ATP does not count München on-hand.
- [ ] Workshop site change while `SCHEDULED` retargets bay; `INTAKE` → 422; concurrent INTAKE vs site PATCH → one 409.
- [ ] Sales `CONFIRMED`, vehicle purchase `RECEIVED`, vehicle sale `INVOICED` freeze site.
- [ ] Vehicle sale site PATCH when the lot is the other site → 422 (requires a vehicle move, not a document edit).
- [ ] Dest-only transfer request: 201 without source bin; site directory returns Wien **name** but not Wien bins; GET source locations of from-site → 403/404; cannot set `sourceLocationId`.
- [ ] Sales/PO/vehicle site PATCH without target membership → 422 (directory ID is not enough).
- [ ] Same-GmbH full ship then partial receive/return; `received + returned ≤ shipped`; mixed receive/return ends `COMPLETED` not `RECEIVED`. Ship omitting a line or `shipQty < approved_qty` → 422.
- [ ] Second partial receive with a **different** `destLocationId` → 422; same frozen dest → 200.
- [ ] Cross-GmbH create/approve/ship → 422.
- [ ] Ship blocked when `approved_qty` > `on_hand - reserved`.
- [ ] Tenant with **no** `WorkshopSettings` row backfills `Europe/Vienna`, `30`, `AT`, and `DEFAULT_OPENING_HOURS` (Saturday `08:00`–`12:00`, Sunday closed — not seven open `07:30`–`17:00` days).
- [ ] Partial receive retry with same `idempotencyKey` **and** body is a no-op even across API instances (durable `stock_transfer_commands` row); same key different body → 409; stale `expectedVersion` on a **new** key → 409.
- [ ] Transfer dual-room: Wien and München **site** sockets both get the event; a third site does not. A Salzburg-active user who is a Wien member gets the event on **`user_{firebaseUid}`** (transfer list), not Wien planner events. Emitting to `user_{User.id}` must not be treated as success.
- [ ] Line insert with `source_location_id` of the to-site (or dest of the from-site) is rejected by the composite FK.
- [ ] Second socket for the same user leaves the old site room after `site_context_updated`.
- [ ] `PATCH` site `is_active=false` with a `SHIPPED` transfer, open workshop order, or on-hand qty → 422; empty site with only `COMPLETED` history → 200.
- [ ] `PATCH` legal entity `is_active=false` while it still has an active site → 422.
- [ ] In-transit location absent from location pickers; direct delete 409; source bin disable blocked while outstanding.
- [ ] Concurrent site-switch vs document commit: guarded transaction decides the winner.

### Frontend

- [ ] Visual QA: switcher, two-site planner, transfer request without source bin, receive remaining qty.
- [ ] After switch, board/stock refetch; customer list does not flash empty.

---

## Out of scope

- HR home-site, attendance per site, leave per site.
- Cross-GmbH / intercompany stock (needs a legal Rechnung).
- Legal Invoicing: seller identity, DACH PDF, credit notes, DATEV/BMD, invoice number series per entity.
- ZUGFeRD / XRechnung.
- Full operational split beyond planner + stock (no per-site employee roster).
- Request→approve extra workflow beyond the states above (no multi-level approval).
- Partial ship / remaining-to-ship (ship is one-shot full `approved_qty`).
- Per-receipt destination allocations (one dest bin per line; freeze on first receive).
- Privileged site deactivation while open work or stock remains.
- Site as a second Prisma `$extends` filter.

---

## Open Questions

None. Product rulings above are the decisions from the 2026-08-31 design review. Multi-Location implementation issues are cut after spec approval. Legal Invoicing Linear project stays paused.

---

## References

- ADR-0022: Site is request-scoped operational ownership
- ADR-0013: Row-level multi-tenancy (`tenant_id` only in Prisma `$extends`)
- ADR-0001: Real-time sync (amended: site rooms)
- ADR-0002: Ledger-based inventory
- ADR-0005 / `docs/deletion-policy.md`
- ADR-0009: Sequential numbering (`TR-{YYYY}-{XXXX}` for transfers)
- ADR-0011: Atomic status transition guards
- ADR-0020: HR remains tenant-wide
- ADR-0021: Stock locking order, cost basis, ATP `on_hand - reserved`
- Linear (paused): [Legal Invoicing & Accounting Export](https://linear.app/auto-core-platform/project/legal-invoicing-and-accounting-export-e2ee5c7e7695)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | None yet. Legal Invoicing project remains paused. |
| Milestone | Slice 1 — planner + stock + same-GmbH transfers |
| Issues | [AUT-249](https://linear.app/auto-core-platform/issue/AUT-249/docs-multi-location-sites-feature-spec-and-adr-0022) (this spec/ADR docs PR). Implementation issues cut after spec approval. |
