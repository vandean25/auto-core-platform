---
title: "Multi-Location Sites and Legal Entities"
date: "2026-08-31"
module: "Platform"
status: approved
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
3. **`legal_entity_id`** is the future fiscal/accounting boundary. Slice 1 stores a thin entity (name, country `AT` \| `DE`, `is_active`) so transfers can require the same GmbH. No Steuernummer, UID, IBAN, or invoice number series here. **Known limitation:** a tenant whose `WorkshopSettings.holiday_country_iso` is neither AT nor DE (e.g. `CH`) still gets a LegalEntity `country_iso = AT` (ruling 39 backfill). Slice 1 does not invent a second entity for that tenant; a later spec adds a real non-AT/DE LegalEntity when needed.
4. **`Site.legal_entity_id` is immutable** after insert. Changing GmbH would silently rewrite historical transfers and future invoice issuer resolution. **Create and reactivate require an active parent entity:** `POST /api/sites` and `PATCH /api/sites/:id` `is_active=true` → **422** unless `LegalEntity.is_active`. Slice 1 has no atomic “reactivate entity + site” endpoint; reactivate the entity first.

### Membership vs employees

5. **`SiteMembership`** controls which users may activate a site. It does **not** make `Employee` site-owned. Employees, attendance, and leave stay tenant-wide (ADR-0020). Composite FK `(tenant_id, user_id) → tenant_members (tenant_id, user_id)` (existing unique). A user with no `TenantMember` in that tenant cannot receive a site grant. Create/reactivate also requires that `TenantMember` to be `is_active`.
6. **`OWNER` / `ADMIN`** come from `TenantMember`. `SiteMembership` is access-only (no per-site role column in slice 1).

### Session and SiteContext

Ruling numbers are **append-only** from review rounds (not sequential in this file). Implementation issues cite these numbers as locked; do not renumber.

7. **`User.active_site_id`** is the session site. `SiteContextService` loads it and validates: active tenant, site belongs to that tenant, site `is_active`, **active `TenantMember` in that tenant**, and active `SiteMembership`. The composite FK on `site_memberships` proves a `TenantMember` **row** exists; it does **not** imply `TenantMember.is_active`. Operational APIs call `siteContext.getSiteId()` — never `?siteId=` or `X-Site-Id`. Sending `siteId` as a list filter on an operational endpoint is **400**.
8. **`422 ACTIVE_SITE_REQUIRED`** only from **site-dependent operational APIs**. Tenant-wide APIs, `GET /me/sites`, and `PATCH /me/active-site` remain usable so the user can recover. `GET /me/sites` lists only activatable sites (ruling 47). Switching **never auto-selects** another site.
9. **`PATCH /me/active-site`** transactionally validates tenant, site, active membership, and site activity, then updates the user. Success emits **`site_context_updated`** on that user’s private socket room with `{ siteId }` (or `null` when cleared). The room identity is the existing gateway prefix **`user_{firebaseUid}`** (`DashboardGateway.USER_ROOM_PREFIX`). `AuthenticatedUser.userId` and `socket.data.userId` are already the Firebase UID (`auth-session.service.ts` `buildSession`). **Do not** emit to `user_{User.id}` — `SiteMembership.user_id` is the relational UUID and that room has no sockets. **Every** socket for that user must leave the previous site room and join the new one (or no site room). Tenant-wide caches stay valid. The initiating tab is not special.
10. Removing a `SiteMembership` that matches `User.active_site_id` **clears `active_site_id` atomically** (null) and emits `site_context_updated` (`siteId: null`). Deactivating the user’s active site does likewise. The user gets `ACTIVE_SITE_REQUIRED` on the next operational call until they PATCH a remaining site. **Any** membership grant, revoke, or deactivate — including a site that is **not** `active_site_id` — also emits **`site_access_scope_updated`** on `user_{firebaseUid}` so cached `GET /api/stock-transfers`, `GET /api/sites`, and `GET /me/sites` results are dropped. Resolve `User.firebaseUid` from `SiteMembership.user_id` before emit. **`TenantMember.is_active = false`** is the same class of event: emit `site_access_scope_updated`; if `User.active_tenant_id` is that tenant, run the shared tenant-change helper (ruling 11) so `active_site_id` is nulled in the same write (do not wait for the next session load).
11. **Every mutation of `User.active_tenant_id` uses one shared helper — that helper is the only production writer of the column.** Live code has **four** writers that today set `active_tenant_id` **alone**:
    - `AuthSessionService.switchTenant` (`auth-session.service.ts`; `POST /api/auth/switch-tenant`)
    - `AuthSessionService.ensureActiveMembership`
    - `TenantMemberService` invite/create when the user has no active tenant (`tenant-member.service.ts` auto-assign)
    - `TenantMemberService.syncUserClaims` — membership-deactivation / claims-reconcile (the path ruling 10 legislates)
    After the composite FK `(active_tenant_id, active_site_id) → sites(tenant_id, id)`, leftover `active_site_id` from a previous tenant violates the constraint on **any** of these paths. The helper **must** atomically set `active_tenant_id` **and** `active_site_id = null`. Never auto-pick a site in the destination tenant. Emit `site_context_updated` with `siteId: null` to every socket in `user_{firebaseUid}` (switch-tenant also keeps existing `auth:claims_updated`). Seed scripts that write `active_tenant_id` must use the helper or include `active_site_id` in the same update. Static/e2e guard: no service writes `active_tenant_id` except through the helper. Recovery: `GET /me/sites` then `PATCH /me/active-site`.
12. Named cross-site methods (`listAcrossAuthorizedSites()`, transfer APIs) derive permitted **operational** site IDs **only** from the caller’s **active `SiteMembership` rows joined to an active `TenantMember`**. They never accept an unrestricted caller-provided list. No generic “bypass site filtering” flag. **Exception — site directory (names only):** any user with at least one such grant may list active sites in the current tenant as `{ id, code, name, legalEntityId }` so a dest-only requester can name `from_site_id`. That directory **must not** include on-hand, bins, bays, or orders. Source locations remain from-site membership only. **Nested includes of site-owned models** (ruling 44) use this helper or `SiteContext` — never a tenant-only `include`.

### Document site ownership

13. **Create** stamps `site_id = SiteContext.getSiteId()`. After create, **never infer** the document’s site from the user’s current switcher. Read `document.site_id`.
14. **Site PATCH is a guarded atomic transition** (ADR-0011 style). **Every** document site change requires an **active `SiteMembership` on the target site** (workshop, sales, purchase order, vehicle purchase, vehicle sale). Names-only directory IDs are not authorization. Stale status/site → **409**. Past the permitted boundary → **422**. The site-change write and the commit transition cannot race: one guarded transaction wins.
15. **WorkshopOrder:** site change allowed only while `SCHEDULED`. Atomically retarget: `bay_id` must be a bay of the target site (required; 422 if omitted or still a source-site bay). Clear or revalidate any reservations, kits, and staging bin so none remain on the source site. Frozen from `INTAKE`.
16. **SalesOrder:** site change allowed only while `DRAFT`. Frozen at `CONFIRMED` (and after).
17. **VehiclePurchase:** site change allowed only while `DRAFT`. Destination lot must belong to the target site. Frozen at `RECEIVED`.
18. **VehicleSale:** site change allowed only while `DRAFT`. The parked vehicle must **already** belong to the target site (**lot’s** `site_id` only; ruling 40). Otherwise the caller uses the **named vehicle move**; a document-site edit is not a vehicle transfer. Frozen at `INVOICED`. `CANCELLED` stays frozen.
19. **PurchaseOrder** is site-owned (receive lands in that site’s locations). Same draft-then-freeze as sales: editable while `DRAFT`, frozen when the PO leaves `DRAFT`.
44. **Every include/subquery of a site-owned model is site-scoped.** Customer and Vehicle stay tenant-wide as **identity** parents. Live `CustomerService.findOne` includes `sales_orders` and `workshop_orders`, and `VehicleService.findOne` includes the same, with **tenant-only** predicates (`customer.service.ts`, `vehicle.service.ts`). `VehicleStockQueryService.detail` includes `workshop_orders`, `purchases`, and `sales` the same way. A Wien-only user can therefore read München documents through those nested histories even when top-level planner lists are site-scoped. **Require** each include, nested `where`, and related **count** of a site-owned model (`WorkshopOrder`, `SalesOrder`, `PurchaseOrder`, `VehiclePurchase`, `VehicleSale`, `StockTransfer`, …) to use `SiteContext.getSiteId()` **or** `listAcrossAuthorizedSites()`. Nested customer/vehicle histories use the **authorized-sites helper**. **`GET /api/vehicle-stock/:id` top-level is active-site only** (rulings 48–49): missing/invalid SiteContext is **422 `ACTIVE_SITE_REQUIRED`**; a valid active site whose lot is elsewhere is **404**. Only its nested `purchases` / `sales` / `workshop_orders` may use the authorized-sites helper. Invoices remain tenant-wide. A tenant-only `include` of a site-owned relation is a cross-site leak.
48. **Vehicle has a dual-role projection.** Live `VehicleService.findAll`/`findOne` and `CustomerService.findOne` `vehicles: true` return Prisma scalars `location_id`, `inventory_role`, and `stock_status` with tenant-only predicates, so a Wien-only user can identify München dealer stock and its lot through CRM. Identity/customer fields (VIN, plate, make/model/year, `customer_id`, customer identity) stay tenant-wide. **Dealer-stock operational fields** (`location_id`, resolved lot/site, `stock_status`, dealer `inventory_role` when `USED`/`NEW`/`DEMO`, reservation) are omitted or null unless the caller is authorized for **that vehicle’s lot site** (active `TenantMember` + active `SiteMembership` on `location.site_id`). `CUSTOMER`-role vehicles have no lot and need no redaction. `GET /api/vehicle-stock` list and `GET /api/vehicle-stock/:id` remain SiteContext operational APIs (ruling 49 for the detail error split).

### Vehicle stock

40. **Vehicle lot / site move is a named contract**, not an unconstrained `location_id` write. Live `PATCH /api/vehicle-stock/:vehicleId` currently accepts `location_id` with **tenant-only** location lookup (`vehicle-stock-query.service.ts`). After this spec:
    - **Parked-vehicle site is single-valued and lot-only.** `VehiclePurchase.vehicle_id` is **not** unique (repeat acquisitions of the same VIN). Do **not** resolve site via `location.site_id else VehiclePurchase.site_id`. `VehiclePurchase` `RECEIVED` requires a non-null `location_id` that is `type = vehicle_lot` of **that purchase’s site**, with composite FK `(tenant_id, site_id, location_id) → storage_locations (tenant_id, site_id, id)`. While `DRAFT`, the purchase row owns the intended site (`VehiclePurchase.site_id`); the dealer `Vehicle` does not exist as parked stock until receive. After receive, every parked dealer vehicle (`USED`/`NEW`/`DEMO` with `stock_status` in `IN_STOCK`/`RESERVED`/`IN_PREP`) has a non-null lot; site is **only** `location.site_id`. Optional denormalized `vehicles.site_id` is derived from the lot and protected by the same composite FK — not independently writable.
    - **`ON_ORDER` is a purchase-list projection, not a persisted `Vehicle` row** (ruling 46). Live `VehicleStockStatus.ON_ORDER` exists, but `vehicle-stock-query.service.ts` only **synthesizes** it on draft-purchase list DTOs (`stock_status: ON_ORDER`, `draft_purchase_id`). Production writes never set `vehicles.stock_status = ON_ORDER` today; keep that as an invariant.
    - **Same-site lot change:** `PATCH /api/vehicle-stock/:vehicleId` `{ location_id, expectedLocationId }`. `SiteContext` site must equal the vehicle’s current **lot** site. Destination must be `type = vehicle_lot` of **that** site. A Wien lot id while the car is on München → **422**.
    - **Cross-site same-GmbH:** `POST /api/vehicle-stock/:vehicleId/move-site` `{ toSiteId, toLocationId, expectedLocationId }`. Vehicle is dealer stock and not `SOLD`. Destination lot is `vehicle_lot` of `toSiteId`. Both sites share `legal_entity_id` and are `is_active`. Caller has **active `TenantMember` + active `SiteMembership` on source and target**. Cross-GmbH → **422**.
    - **OCC / locking:** both paths take a vehicle row lock (`SELECT … FOR UPDATE` or guarded `updateMany` on `id` + `location_id = expectedLocationId` + non-`SOLD`). Stale `expectedLocationId` → **409**. Recheck non-`SOLD`, dest lot, and **both sites `is_active`** at commit. Lock order with competing `VehicleSale` site PATCH/finalize and site deactivation: **globally sorted `site_id`s**, then `vehicle_id`, then `vehicle_sale_id` if present (same discipline as ADR-0021). Two `move-site` calls, move vs sale, and move vs site deactivation are 409 for the loser. Atomic location update plus `AuditLog` (`before`/`after` location and site). No new `VehicleLedgerEntryType`.
    - `VehicleSale` site PATCH (ruling 18) requires the parked vehicle’s **lot site** to already equal the target; it does not retarget the lot.
    - **Lot disable/delete cannot drop a parked car** (ruling 45). Live `LocationService.remove` checks child locations and `InventoryStock` only; `Vehicle.location` is `onDelete: SetNull`. A soft-deleted `vehicle_lot` can stay attached, and a hard delete would null `location_id`, leaving a non-`SOLD` dealer vehicle without a usable lot. **Block** disable, soft-delete (`deletedAt`), and hard-delete while any non-`SOLD` dealer vehicle (`IN_STOCK`/`RESERVED`/`IN_PREP`) references the lot — move or sell first (**409**). Change the `VehicleLot` relation from `onDelete: SetNull` to **`onDelete: Restrict`**. Transfer outstanding-qty guards (ruling 31–34) still apply in addition.
    - **Migration:** (1) **Assert zero** dealer `Vehicle` rows with `stock_status = ON_ORDER` — do **not** assign them a `LOT` (they are not parked stock); fail the migration if any exist. (2) Preflight every remaining non-`SOLD` dealer vehicle (`IN_STOCK`/`RESERVED`/`IN_PREP`) whose `location_id` is null or not `vehicle_lot`. Remediate by assigning (or creating) `code = LOT` on the tenant `MAIN` site. Assert zero remaining bad rows before `NOT NULL` / composite FK. Do not guess a site from historical `VehiclePurchase` rows.

### Planner and stock

20. **Bays, opening hours, holidays, timezone, slot length** are per site. Tenant singleton `WorkshopSettings` is replaced: those fields live on `Site`; `WorkshopOpeningHour` / `WorkshopHoliday` FK to `Site`.
21. **Every `StorageLocation` belongs to exactly one site.** ATP, kitting, and on-hand lists use locations of the current site only. Tote / staging locations cannot be another site’s. Hierarchy is site-safe: `parent_id` is a composite FK `(tenant_id, site_id, parent_id) → storage_locations (tenant_id, site_id, id)`, nullable for roots. A München bin cannot parent under a Wien aisle.
22. **`InventoryStock.site_id` is not independently writable.** Stock is site-scoped through `StorageLocation.site_id`. If denormalized for query performance, it is mechanically derived and protected against disagreement with the location via `(tenant_id, site_id, location_id) → storage_locations (tenant_id, site_id, id)`. The same composite FK is required on **`inventory_transactions`**: a ledger row cannot claim Wien while pointing at a München location.
23. **Same-site bin→tote** stays an instant `TRANSFER_OUT` + `TRANSFER_IN` pair (ADR-0002 / kitting). That is **not** a `StockTransfer` document.
24. **No shared pool.** ATP must not see another site’s on-hand.

### Transfers (same GmbH only)

25. **`StockTransfer`** is a document with immutable `from_site_id` and `to_site_id` (must differ). Both sites must share `legal_entity_id` at **create, approve, and ship**. Cross-GmbH → **422**. Intercompany sale is Legal Invoicing, not this spec.
26. **Requester membership is on either endpoint**, not both. A destination-only user may create a request naming `from_site_id` + qty, and **must not** inspect or set a source bin. Source membership selects `source_location_id` at **approve or ship**. If the requester also has from-site membership, they may suggest a source bin at create. **Create UX:** From-site picker is the names-only directory (`GET /api/sites`), not memberships-only. To-site picker defaults to the current site and also uses the directory so a from-only clerk can name dest. Submit **422** unless the caller has active membership on from **or** to. Source-bin field is omitted unless the caller has from-site membership. **Every transfer response uses the same rule** (ruling 43): after approve/ship the line persists `source_location_id`; a dest-only caller must not receive that id or resolved Wien bin details from GET, POST action, or realtime. `from_site_id` / from-site **name** (directory identity) stay visible.
27. **Line qty domains and payload uniqueness.** Columns: `requested_qty`, `approved_qty`, `shipped_qty`, `received_qty`, `returned_qty`. Persist and enforce: `requested_qty > 0`; `0 <= approved_qty <= requested_qty`; every persisted counter `>= 0`; `received_qty + returned_qty ≤ shipped_qty` (atomic). Submitted `receiveQty` / `returnQty` must be `> 0`. **Create** requires at least one line; `POST /api/stock-transfers` with `lines: []` or omitted `lines` → **400**. **Approve:** omitted `lines` means the server expands to **every** line with `approved_qty = requested_qty` (and keeps any already-set source bin). A **present** `lines` array must be non-empty and have unique ids; `lines: []` → **400** (it is not “approve nothing”). Ship/receive/return bodies always require a non-empty unique `lines` array. Duplicate `id` → **400** at the DTO, **422** if it reaches the guarded transaction. Negative or duplicate inputs must not reverse or double-apply ledger movement. Enforce in DTOs **and** the guarded transaction (optional DB `CHECK` on the qty columns).
28. **Each line copies immutable `from_site_id` / `to_site_id` from the parent at create.** Composite FKs prove source bin belongs to from-site and dest bin belongs to to-site (see Database Impact). Service-only checks are not sufficient.
29. **States:** `REQUESTED` → `APPROVED` → `SHIPPED` → `COMPLETED`. Also `REJECTED` (from `REQUESTED`), `CANCELLED` (from `REQUESTED` or `APPROVED` only — no ledger yet). **Ship is one-shot and full:** `APPROVED → SHIPPED` happens once. For every line, `shipped_qty = approved_qty`. Require and freeze `source_location_id` **only where `approved_qty > 0`**. Zero-approved lines stay `shipped_qty = 0`, `source_location_id` null, **no ledger pair**. At least one line must have `approved_qty > 0`. Partial ship is out of scope (no remaining-to-ship, no second ship). Partial **receipt** leaves the document `SHIPPED`. When outstanding shipped qty is zero (`received + returned = shipped` on every line), the document becomes **`COMPLETED`**. Do not call a mixed receive/return `RECEIVED`.
30. **Receive and return** require **both** `expectedVersion` and `idempotencyKey`. Lookup the durable command row **before** OCC: same `(tenant_id, transfer_id, action, idempotency_key)` + same request hash returns the stored first result (no second ledger write), even if `version` has since incremented. Same key, different body hash → **409**. Missing row + stale `expectedVersion` → **409**. Persist the command row **atomically** with qty counters and ledger pairs (table below). In-memory keys are not enough for multi-instance Cloud Run. **Concurrent same-key:** two instances may both miss the pre-OCC lookup. The winner commits the version, ledger, and command row. The loser that hits OCC **or** the unique `(tenant_id, transfer_id, action, idempotency_key)` constraint **must re-read the command row** and return the stored response when the hash matches — not a stale-version 409. Hash mismatch after that re-read → **409**. Approve/reject/cancel/ship use `expectedVersion` only (no ledger partials).
31. **Destination bin is frozen on first receive.** `StockTransferLine` has one `dest_location_id`. The first successful receive that writes it locks that bin. Every later partial receive for that line must send the **same** `destLocationId` → **422** on mismatch. Slice 1 does not persist per-receipt destination allocations. **Soft-delete / disable of that dest bin is 409** while `shipped_qty > received_qty + returned_qty` on any line that froze it — even if received stock was later moved out and on-hand at the dest is zero. The remaining transfer cannot pick another bin.
32. **Authz:**
    - Request: active membership on **to** or **from**.
    - Approve / reject: active membership on **from** and `TenantMember` `OWNER`/`ADMIN`.
    - Ship: active membership on **from**.
    - Receive: active membership on **to**.
    - Return-unreceived: membership on **to**, or **from** `OWNER`/`ADMIN`.
33. **Ship availability** is atomic against `on_hand - reserved` at the source location, under the established stock locking order (ADR-0021: globally sorted ids, `SELECT … FOR UPDATE`). Reserved kit qty cannot ship.
34. **In-transit:** each site has one system location `type = in_transit`, `code` deterministic (e.g. `TRANSIT`). Non-selectable, non-deletable, non-disableable; excluded from normal location lists and from ATP/kitting. **Each ledger row’s `site_id` is the site of that row’s `location_id`** (composite FK). A pair-level `to_site_id` on a from-site location is unsatisfiable. Ship: `TRANSFER_OUT` source bin + `TRANSFER_IN` from-site in-transit — **both** `site_id = from_site_id`. Receive: `TRANSFER_OUT` from-site in-transit (`site_id = from_site_id`) + `TRANSFER_IN` dest bin (`site_id = to_site_id`). Return: `TRANSFER_OUT` from-site in-transit (`site_id = from_site_id`) + `TRANSFER_IN` original source bin (`site_id = from_site_id`). The **source bin**, **from-site in-transit**, and **frozen dest bin** cannot be disabled or soft-deleted while transfer qty remains outstanding on that line (`shipped_qty > received_qty + returned_qty` for dest; remaining in-transit for source).
35. **Every movement pair** has a unique `movement_group_id` in addition to `reference_id` = transfer id, so partial receipts reconcile. **Cost basis** follows the stock through in-transit, receipt, and return (copy; do not re-read live catalog).
36. Transfer mutations **publish to both endpoint site rooms** and to **`user_{firebaseUid}` of every user** with an **active `SiteMembership` and an active `TenantMember`** on from or to. Resolve Firebase UID from `SiteMembership.user_id` → `User.firebaseUid`; emitting to the relational UUID reaches no socket. Do **not** select a site grant whose tenant membership is suspended. That keeps the cross-site transfer list current for a Salzburg-active user who also belongs to Wien. Do **not** join all membership site rooms on the operational board (that would mix Wien planner events into a Salzburg session). **Source-bin redaction is per recipient** (ruling 43): payloads sent to a socket whose user lacks active from-site membership omit source location identifiers/details. Do not broadcast one unredacted payload to mixed from/to rooms.

### Realtime

37. Isolation is **server-side site rooms**, not client-side filtering. On connect: join `site:{siteId}` for the active site (if any) and `user_{firebaseUid}`. Stay in the tenant room. Operational entity events emit to the document’s site room. Tenant-wide entities emit to the tenant room only. `site_context_updated` on the user room is how a second tab learns the switch; `site_access_scope_updated` is how a second tab learns a membership change (site **or** tenant) that did not clear the active site.

### Deletion

38. Normal `LegalEntity` / `Site` removal is **deactivation** (`is_active = false`). **`PATCH /api/sites/:id` `is_active=false` is 422** while any of the following exist for that site:
    - a `StockTransfer` **not** in `COMPLETED` / `REJECTED` / `CANCELLED` (as from or to)
    - a site-owned document **not** in that type’s terminal set (locked from the live enums; there is **no** `WorkshopOrderStatus.CANCELLED` and **no** `SalesOrderStatus.CANCELLED`):
      - `WorkshopOrder`: terminal `INVOICED` only (`SCHEDULED` may be hard-deleted instead; `COMPLETED` is still live — vehicle ready, not invoiced)
      - `SalesOrder`: terminal `INVOICED` only
      - `PurchaseOrder`: terminal `COMPLETED` only
      - `VehiclePurchase`: terminal `RECEIVED` or `CANCELLED`
      - `VehicleSale`: terminal `INVOICED` or `CANCELLED`
    - on-hand, reserved, or in-transit quantity at any of the site’s locations
    - a **parked dealer vehicle** whose **lot** belongs to the site: `inventory_role` `USED`/`NEW`/`DEMO`, `stock_status` in `IN_STOCK`/`RESERVED`/`IN_PREP` (not `SOLD`, **not** `ON_ORDER` — ruling 46 forbids persisted `ON_ORDER` vehicles), `location.site_id` = this site. Do not consult `VehiclePurchase.site_id`. `VehiclePurchase` `DRAFT` already blocks via the non-terminal document rule; `RECEIVED` does not clear the car.
    OWNER/ADMIN must complete, invoice, cancel (where the enum exists), sell, or **move** that work first (ruling 40 for vehicles). Slice 1 has **no** privileged “deactivate anyway / read-only completion” path. **`PATCH /api/legal-entities/:id` `is_active=false` is 422** while the entity has any `Site` with `is_active = true`. When site deactivation is allowed, clear `active_site_id` for users whose active site is this site and emit `site_context_updated` (`siteId: null`) plus `site_access_scope_updated`. Hard delete only for unused setup mistakes (see `docs/deletion-policy.md`). Pristine site hard-delete may internally remove its empty system transit location and hours/holiday config; that location remains forbidden from **direct** deletion APIs.
39. Site hard-delete checks **transfers, ledger history, storage locations, memberships, bays, parked vehicles, and every site-owned document** — not only stock and bays.
41. **Site deactivation is serialized with every write that can create new site-owned work or stock.** The `is_active=false` guard is not check-then-toggle. Deactivation `SELECT … FOR UPDATE`s the site row, rechecks transfers/documents/qty/parked vehicles, then toggles. Workshop/sales/PO/vehicle create, goods receipt, transfer create/approve/ship/receive, document site PATCH, and vehicle move/lot PATCH **recheck `Site.is_active` under that same site-row lock** at commit — `SiteContext` at request start is not enough. Two-site operations lock both sites in **globally sorted `site_id` order** (then vehicle/transfer ids). Every caller-supplied target site (directory id, `toSiteId`, document site PATCH) must be `is_active` or the write is **422**. Concurrent deactivate-vs-create/receipt/transfer/move: one 409/422 for the loser.
42. **Status gate (historical).** Feature Spec frontmatter is `approved` and ADR-0022 is **Accepted** as of the ruling-42 follow-up after approval at `6159dad`. Later finding-lock commits keep those statuses; they do not revert to `draft` / `Proposed`.
43. **Every transfer HTTP and realtime response uses one caller-aware serializer.** Add `GET /api/stock-transfers/:id` (membership on from **or** to; **404** if neither). Omit or null `sourceLocationId` and any resolved source-bin name/code/path unless the caller has **active from-site `SiteMembership` and active `TenantMember`**. `fromSiteId` / from-site directory name remain. Apply this to **list, detail, create, approve, reject, cancel, ship, receive, return**, realtime payloads (ruling 36), **and** idempotent command replays (do not return stored `response_body` raw). Dest-only receive/return after the source bin is frozen is the leak path if those POSTs return the Prisma row.
45. **A `vehicle_lot` referenced by a parked dealer vehicle cannot be disabled or deleted.** See ruling 40. `LocationService.remove` must count non-`SOLD` dealer `Vehicle.location_id` in addition to children, parts stock, and outstanding transfer references. FK `onDelete: Restrict`.
46. **Zero persisted dealer `Vehicle` rows with `stock_status = ON_ORDER`.** Enum value stays for the draft-purchase list DTO only. Service/DB must reject future writes. Migration asserts zero such rows and does not park them on `MAIN` `LOT`. Deactivation and lot-required guards therefore list `IN_STOCK`/`RESERVED`/`IN_PREP` only — there is no ON_ORDER parked car to include or exclude inconsistently.
47. **`GET /api/me/sites` returns only activatable sites:** `Site.is_active` **and** active `SiteMembership` **and** active `TenantMember` (current tenant). Site deactivation leaves membership rows and clears `active_site_id`; the recovery list must not offer a site that `PATCH /api/me/active-site` would reject.
48. **Vehicle dual-role projection** — see Document site ownership. CRM identity stays tenant-wide; dealer-stock location/site/status fields require lot-site authorization. `GET /api/vehicle-stock/:id` is active-site only.
49. **`GET /api/vehicle-stock/:id` error split.** Live `VehicleStockQueryService.detail` looks up `{ id, tenant_id }` and throws `NotFoundException` when missing. After SiteContext: missing/invalid active site → **`422 ACTIVE_SITE_REQUIRED`** (ruling 8) — not 404. With a valid SiteContext, find the parked dealer vehicle whose **lot site** is `getSiteId()` (`location.site_id`, or derived `vehicles.site_id` if denormalized). Miss — unknown id, `CUSTOMER` role, no lot, **or lot at another site** — is **`404`**. Do not return 422 for an other-site vehicle even if the caller has membership there (that leaks existence and contradicts the active-site-only contract). Nested histories apply only on a **200** detail.
50. **The tenant-change helper is the only production writer of `User.active_tenant_id`.** See ruling 11 for the four live call sites (`switchTenant`, `ensureActiveMembership`, `TenantMemberService` invite auto-assign, `syncUserClaims`). A Prisma `user.update` of `active_tenant_id` outside the helper is a composite-FK bug.
51. **Ledger `site_id` is per row, not per pair.** See ruling 34. Receive/return OUT rows that point at from-site in-transit **must** carry `from_site_id`.
52. **Transfer numbers are a tenant-wide ADR-0009 series.** Add `finance_settings.next_stock_transfer_number` (default `1`) and `stock_transfer_prefix`. Assign at **create** (same as workshop orders). Unique `(tenant_id, transfer_number)`. Not per site and not per legal entity in slice 1; Legal Invoicing may later split legal document series. **Prefix column is a literal string**, same family as `invoice_prefix` / `sales_order_prefix` / `workshop_order_prefix` (`schema.prisma` defaults `"RE-2026-"`, `"SO-2026-"`, live create uses `` `RE-${currentYear}-` ``). Prisma/seed default **`TR-2026-`**; upserts use `` `TR-${currentYear}-` ``. Assignment concatenates `stock_transfer_prefix` + zero-padded counter (live sales-order pattern: `` `${settings.sales_order_prefix}${counter}` ``). The column does **not** store a `{YYYY}` template and the service does **not** interpolate `{YYYY}` from it. `TR-{YYYY}-{XXXX}` is the human format in ADR-0009, identical to `RE-{YYYY}-{XXXX}`.
53. **Admin listing includes inactive sites/entities.** Default `GET /api/sites` stays the names-only **active** directory (membership-gated). `GET /api/sites?includeInactive=true` is **OWNER/ADMIN**, full rows, active **and** inactive, **no** `SiteMembership` required — this is how reactivation gets an id after deactivation. `GET /api/legal-entities` is OWNER/ADMIN and includes inactive entities (optional `includeInactive=false` to hide them). `GET /api/sites/:id` already allows OWNER/ADMIN without membership.
54. **New tables carry timestamps (and transfer actors).** `legal_entities`, `sites`, `site_memberships`, `stock_transfers`, `stock_transfer_lines` have `createdAt` / `updatedAt` like every comparable document in `schema.prisma`. `stock_transfers` also: nullable `approved_by_user_id`, `shipped_by_user_id`, `received_by_user_id`; nullable `reject_reason` / `cancel_reason`. Reject/cancel POST may send `{ expectedVersion, reason? }`.
55. **`stock_transfer_commands.created_at` is required.** Slice 1 retains rows for the tenant lifetime (deletion policy: never deleted through ordinary APIs; tenant purge only). Do not purge on `COMPLETED`. Unbounded by design until a later retention spec.
56. **`GET`/`PUT /api/workshop/settings` stay the route** (`WorkshopController` today). They become SiteContext read/write of the **current site’s** timezone, slot, holiday country, and opening hours. Drop the `workshop_settings` table in the **contract** migration after expand/backfill/validate — not in expand.
57. **`stock_transfer_prefix` is a literal prefix column.** See ruling 52. Do not introduce `{YYYY}` expansion unique to this series.

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
| | `createdAt`, `updatedAt` | datetime | no | Same as other tenant documents |
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
| | `createdAt`, `updatedAt` | datetime | no | |
| `site_memberships` | `id` | uuid | no | |
| | `tenant_id` | uuid | no | |
| | `user_id` | uuid | no | Composite FK `(tenant_id, user_id) → tenant_members (tenant_id, user_id)` |
| | `site_id` | uuid | no | Composite tenant+site FK |
| | `is_active` | boolean | no | Preserve `TenantMember.is_active` on backfill |
| | | | | Unique `(tenant_id, user_id, site_id)` |
| | `createdAt`, `updatedAt` | datetime | no | |
| `stock_transfers` | `id` | uuid | no | PK. Also unique `(tenant_id, id)` |
| | `tenant_id` | uuid | no | |
| | `transfer_number` | string | no | Unique per tenant. Assigned at create: literal `stock_transfer_prefix` + padded counter (ruling 52/57) |
| | `from_site_id`, `to_site_id` | uuid | no | Immutable, must differ, composite site FKs |
| | `status` | enum | no | see rulings |
| | `version` | int | no | OCC for partial receive/return; start at 1 |
| | `requested_by_user_id` | uuid | no | |
| | `approved_by_user_id`, `shipped_by_user_id`, `received_by_user_id` | uuid | yes | Set on the matching transition |
| | `reject_reason`, `cancel_reason` | string | yes | |
| | `createdAt`, `updatedAt` | datetime | no | |
| `stock_transfer_lines` | `id` | uuid | no | |
| | `tenant_id` | uuid | no | |
| | `transfer_id` | uuid | no | Composite FK `(tenant_id, transfer_id) → stock_transfers (tenant_id, id)` |
| | `from_site_id`, `to_site_id` | uuid | no | Copied from parent at create; immutable |
| | `catalog_item_id` | uuid | no | |
| | `source_location_id` | uuid | yes | Null until source membership sets it. When set: `(tenant_id, from_site_id, source_location_id) → storage_locations (tenant_id, site_id, id)` |
| | `dest_location_id` | uuid | yes | Frozen on first receive; later receives must match. When set: `(tenant_id, to_site_id, dest_location_id) → storage_locations (tenant_id, site_id, id)` |
| | `requested_qty`, `approved_qty`, `shipped_qty`, `received_qty`, `returned_qty` | Decimal(10,3) | no | Defaults 0 except requested |
| | `createdAt`, `updatedAt` | datetime | no | |
| `stock_transfer_commands` | `id` | uuid | no | Durable receive/return idempotency |
| | `tenant_id` | uuid | no | |
| | `transfer_id` | uuid | no | Composite FK `(tenant_id, transfer_id) → stock_transfers (tenant_id, id)` |
| | `action` | `RECEIVE` \| `RETURN` | no | |
| | `idempotency_key` | string | no | Caller-supplied |
| | `request_hash` | string | no | Canonical hash of the request body (including line ids/qtys/dest bins; including `expectedVersion`) |
| | `response_status` | int | no | HTTP status of the first outcome |
| | `response_body` | jsonb | no | Canonical first result for replay. HTTP still runs the caller-aware serializer (ruling 43); do not send an unredacted stored body to a dest-only caller. |
| | `createdAt` | datetime | no | Required. Unbounded retention in slice 1 (ruling 55) |
| `inventory_transactions` | `movement_group_id` | uuid | yes | Required on transfer ship/receive/return pairs |
| | `site_id` | uuid | no after contract | **This row’s** `location_id` site (ruling 51), not a pair-level dest site. Composite FK `(tenant_id, site_id, location_id) → storage_locations (tenant_id, site_id, id)` |
| | `stock_transfer_id` | uuid | yes | Composite FK `(tenant_id, stock_transfer_id) → stock_transfers (tenant_id, id)` |

Uniques required for composite FKs (Prisma cannot reference a tuple that is not unique):

- `legal_entities (tenant_id, id)` and `(tenant_id, name)`
- `sites (tenant_id, id)` and `(tenant_id, code)`
- `bays (tenant_id, site_id, id)` and `(tenant_id, site_id, name)`
- `storage_locations (tenant_id, site_id, id)` and `(tenant_id, site_id, code)`
- `site_memberships (tenant_id, user_id, site_id)`
- `tenant_members (tenant_id, user_id)` already exists; `site_memberships` FKs it
- `stock_transfers (tenant_id, id)`, `(tenant_id, transfer_number)`, and `(tenant_id, id, from_site_id, to_site_id)` (parent tuple so lines can FK the copied site ids)
- `stock_transfer_commands (tenant_id, transfer_id, action, idempotency_key)`
- `workshop_holidays (tenant_id, site_id, observed_on)` — **replaces** `(tenant_id, observed_on)` so Wien and München can share a date
- `workshop_opening_hours (tenant_id, site_id, weekday)`

Child FKs that those uniques enable:

- `sites.legal_entity_id`: `(tenant_id, legal_entity_id) → legal_entities (tenant_id, id)`
- Workshop order `bay_id` / staging location: `(tenant_id, site_id, bay_id) → bays (tenant_id, site_id, id)` (same pattern for storage locations)
- `site_memberships`: `(tenant_id, user_id) → tenant_members (tenant_id, user_id)` **and** `(tenant_id, site_id) → sites (tenant_id, id)`
- `stock_transfer_lines`: `(tenant_id, transfer_id) → stock_transfers (tenant_id, id)` **and** `(tenant_id, transfer_id, from_site_id, to_site_id) → stock_transfers (tenant_id, id, from_site_id, to_site_id)`
- `stock_transfer_lines.source_location_id` (when not null): `(tenant_id, from_site_id, source_location_id) → storage_locations (tenant_id, site_id, id)`
- `stock_transfer_lines.dest_location_id` (when not null): `(tenant_id, to_site_id, dest_location_id) → storage_locations (tenant_id, site_id, id)`
- `stock_transfer_commands.transfer_id`: `(tenant_id, transfer_id) → stock_transfers (tenant_id, id)`
- `inventory_transactions.stock_transfer_id` (when not null): `(tenant_id, stock_transfer_id) → stock_transfers (tenant_id, id)`
- `inventory_transactions` location: `(tenant_id, site_id, location_id) → storage_locations (tenant_id, site_id, id)` (replaces the bare `location_id` FK)
- `storage_locations.parent_id` (when not null): `(tenant_id, site_id, parent_id) → storage_locations (tenant_id, site_id, id)`
- `inventory_stocks` if denormalized `site_id`: `(tenant_id, site_id, location_id) → storage_locations (tenant_id, site_id, id)`
- `vehicle_purchases.location_id` (when set / required at `RECEIVED`): `(tenant_id, site_id, location_id) → storage_locations (tenant_id, site_id, id)`
- `vehicles.location_id` for dealer stock (when denormalized `site_id` is present): `(tenant_id, site_id, location_id) → storage_locations (tenant_id, site_id, id)`. Relation `VehicleLot` is **`onDelete: Restrict`** (live code is `SetNull`). Optional CHECK / service invariant: `stock_status <> ON_ORDER` on `vehicles`.
- `workshop_holidays.site_id`: `(tenant_id, site_id) → sites (tenant_id, id)`
- `workshop_opening_hours.site_id`: `(tenant_id, site_id) → sites (tenant_id, id)`
- `User.active_site_id`: composite `(active_tenant_id, active_site_id) → sites (tenant_id, id)` so a site cannot be the active site for another tenant. When `active_site_id` is null (recovery, revoked membership, tenant switch), the FK is not applied.

Indexes: every site-owned table `(tenant_id, site_id)` (transfers: `(tenant_id, from_site_id)` and `(tenant_id, to_site_id)`). `stock_transfer_commands (tenant_id, transfer_id)`.

### Modified tables

| Table | Change | Migration |
|-------|--------|-----------|
| `users` | `active_site_id` nullable; composite FK `(active_tenant_id, active_site_id) → sites(tenant_id, id)` | Yes |
| `bays` | `site_id` NOT NULL after contract; unique `(tenant_id, site_id, name)` | Yes |
| `storage_locations` | `site_id` NOT NULL; unique `(tenant_id, site_id, code)` and `(tenant_id, site_id, id)`; composite parent FK `(tenant_id, site_id, parent_id) → storage_locations (tenant_id, site_id, id)` (null for roots); new `LocationType.in_transit`. Soft-delete/disable **409** while a non-`SOLD` dealer vehicle references the lot (ruling 45) | Yes |
| `workshop_orders` | `site_id` NOT NULL; bay/staging composite site-safe FKs | Yes |
| `sales_orders` | `site_id` NOT NULL | Yes |
| `purchase_orders` | `site_id` NOT NULL | Yes |
| `vehicle_purchases` | `site_id` NOT NULL; `location_id` at `RECEIVED` required and composite `(tenant_id, site_id, location_id) → storage_locations (tenant_id, site_id, id)` (`vehicle_lot` of that site) | Yes |
| `vehicle_sales` | `site_id` NOT NULL | Yes |
| `vehicles` | Parked dealer (`IN_STOCK`/`RESERVED`/`IN_PREP`): `location_id` NOT NULL `vehicle_lot`; `onDelete: Restrict`; **no** persisted `ON_ORDER`. Optional denormalized `site_id` from the lot with the same composite FK — **not** independently writable. No unique on `VehiclePurchase.vehicle_id` | Yes |
| `inventory_transactions` | `site_id` NOT NULL; `movement_group_id`; optional `stock_transfer_id` with composite FK `(tenant_id, stock_transfer_id) → stock_transfers (tenant_id, id)`; location FK becomes `(tenant_id, site_id, location_id) → storage_locations (tenant_id, site_id, id)` | Yes |
| `inventory_stocks` | optional denormalized `site_id` generated/maintained from location — **not** independently writable | Optional |
| `workshop_opening_hours` | FK to `site` instead of tenant `WorkshopSettings`; unique `(tenant_id, site_id, weekday)` | Yes |
| `workshop_holidays` | Drop unique `(tenant_id, observed_on)`. Add `site_id` NOT NULL, composite site FK `(tenant_id, site_id) → sites (tenant_id, id)`, unique **`(tenant_id, site_id, observed_on)`** | Yes |
| `workshop_settings` | **Removed in the contract migration** after expand/backfill/validate (fields live on `Site`). Route `GET`/`PUT /api/workshop/settings` stays (ruling 56) | Yes |
| `finance_settings` | `next_stock_transfer_number` default `1`; `stock_transfer_prefix` Prisma/seed default **`TR-2026-`** (literal, ruling 57); upserts `` `TR-${currentYear}-` `` | Yes |

### Site-owned migration manifest

Expand / backfill / validate / contract. Maintain this list in the migration. Backfill each row. **Assert zero missing or mismatched `site_id`**, then `NOT NULL` and composite FKs. Drop `workshop_settings` in the **contract** phase only (ruling 56) — expand keeps the table so the existing `GET`/`PUT /api/workshop/settings` route still reads it until Site columns are populated and validated.

`bays`, `storage_locations`, `workshop_orders`, `sales_orders`, `purchase_orders`, `vehicle_purchases`, `vehicle_sales`, `inventory_transactions`, `workshop_opening_hours`, `workshop_holidays`.

Parent-derived (no independent writable `site_id` unless denormalized and protected): `inventory_stocks` via location; `workshop_tasks` via order; parked `vehicles` via **lot only** (not via `VehiclePurchase`).

Tenant-wide (no `site_id`): `catalog_items`, `customers`, `revenue_groups`, `brands`, `vendors`, `employees`, `labor_*`, `finance_settings`, `invoices` (issuer snapshot is Legal Invoicing).

### Backfill rules

- One `LegalEntity` per existing tenant: `name = Tenant.name`. `country_iso` from `WorkshopSettings.holiday_country_iso` when that value is **`AT` or `DE`**. Any other two-letter code (`CH`, `US`, … — `UpdateWorkshopSettingsDto` only requires `/^[A-Z]{2}$/`) **falls back to `AT`**. Do **not** fail the migration. Preserve the original code on `Site.holiday_country_iso` so the OpenHolidays calendar stays correct. Missing settings row → `AT` for both.
- One `Site`: `code = MAIN`, name from tenant, **nullable address**. Timezone / slot from `WorkshopSettings` when present, else **`Europe/Vienna`**, **`30`**. `holiday_country_iso` from settings when present (any ISO-2, including non-AT/DE), else **`AT`** (`holiday_subdivision_code` null). `WorkshopSettings` is created lazily today; missing row must not fail the contract.
- One system `in_transit` location per site. One default `vehicle_lot` `code = LOT` on `MAIN` if the tenant has none.
- Assert **zero** dealer `Vehicle` rows with `stock_status = ON_ORDER`. Fail if any exist; do not assign them a lot.
- Remaining parked dealer vehicles (`IN_STOCK`/`RESERVED`/`IN_PREP`) with null or non-`vehicle_lot` `location_id`: assign that `MAIN` `LOT`. Assert zero remaining. Do **not** pick a site from historical `VehiclePurchase` rows.
- Opening hours: copy each valid existing weekday row; then insert **`DEFAULT_OPENING_HOURS`** for **each missing weekday** so every migrated site has **exactly seven** rows (ISO 1–7). Defaults from `apps/core-api/src/workshop/workshop-hours.defaults.ts` — Mon–Fri `07:30`–`17:00`, Saturday `08:00`–`12:00`, Sunday closed. A tenant with only Mon–Fri rows still gets Saturday and Sunday. Do **not** skip fill because some rows already exist. Copy holidays when present.
- `SiteMembership` for **every** `TenantMember`, `is_active` copied from the membership.
- Set `User.active_site_id` **only** when that user’s `active_tenant_id` is this tenant **and** they have an active `TenantMember` there. Users without a valid active tenant membership remain `null`. The composite FK must hold.

### Deletion Policy Impact

Update `docs/deletion-policy.md` (this PR). See ADR-0005.

---

## API Contract Changes

### New endpoints

| Method | Route | Request | Response | Auth |
|--------|-------|---------|----------|------|
| GET | `/api/me/sites` | — | Sites with **`Site.is_active` and active `SiteMembership` and active `TenantMember`** (current tenant). Inactive sites are omitted even if the membership row remains. | session |
| PATCH | `/api/me/active-site` | `{ siteId }` | `{ activeSiteId }` | session; validates both memberships |
| GET/POST | `/api/legal-entities` | create: name, country | GET includes **inactive** entities (optional `includeInactive=false` hides them). POST create. | OWNER/ADMIN |
| PATCH | `/api/legal-entities/:id` | name, `is_active` | entity | OWNER/ADMIN. `country_iso` immutable after create. `is_active=false` **422** while any site of the entity is active. |
| GET | `/api/sites` | — | Directory: `{ id, code, name, legalEntityId }` for **active** sites in the tenant. No bins, stock, or orders. | Any user with ≥1 active `SiteMembership` **and** active `TenantMember` |
| GET | `/api/sites?includeInactive=true` | — | Full site rows (hours, address, `is_active`), active **and** inactive. This is how reactivation gets an id after deactivation. | OWNER/ADMIN; **no** `SiteMembership` required |
| GET | `/api/sites/:id` | — | Full site (hours, address) if membership **or** OWNER/ADMIN | |
| POST | `/api/sites` | legalEntityId, code, name, address, hours | site | OWNER/ADMIN. **422** unless the legal entity is `is_active`. |
| PATCH | `/api/sites/:id` | name, address, hours, `is_active` | site | OWNER/ADMIN; **not** `legalEntityId`. `is_active=false` locks the site row then rechecks (ruling 41). **422** while open transfers, non-terminal site-owned documents, on-hand/reserved/in-transit qty, **or parked dealer vehicles on a lot at this site** remain. `is_active=true` **422** unless the parent `LegalEntity` is `is_active`. |
| POST/DELETE | `/api/sites/:id/memberships` | `{ userId }` | membership | OWNER/ADMIN. POST **422** unless an active `TenantMember` exists for that `(tenant_id, user_id)` (composite FK). |
| POST | `/api/vehicle-stock/:vehicleId/move-site` | `{ toSiteId, toLocationId, expectedLocationId }` | vehicle | Named cross-site lot move (ruling 40). OCC on current lot. Active `TenantMember` + `SiteMembership` on source **and** target. Same `legal_entity_id`; both sites `is_active`. Dest `vehicle_lot` of `toSiteId`. Cross-GmbH or inactive site → 422. Stale `expectedLocationId` → 409. |
| GET | `/api/stock-transfers` | — | transfers where caller has membership on from **or** to. Source-bin redaction via the shared serializer (ruling 43) | named cross-site |
| GET | `/api/stock-transfers/:id` | — | full transfer for the detail page. Same membership and serializer as list. **404** if the caller has neither from nor to membership | named cross-site |
| POST | `/api/stock-transfers` | `fromSiteId`, `toSiteId`, lines (`catalogItemId`, `requestedQty` `> 0`, optional `sourceLocationId` if from-member) | transfer `REQUESTED`, **same serializer** | membership on from or to. ≥1 line; omitted/`[]` → 400. Both sites `is_active`. |
| POST | `/api/stock-transfers/:id/approve` | `{ expectedVersion, lines?: [{ id, approvedQty, sourceLocationId? }] }` | `APPROVED`. **Omitted `lines`:** server expands to all lines, `approved_qty = requested_qty`. **Present `lines`:** non-empty, unique ids; `[]` → 400. Omitted `approvedQty` on a present row defaults to `requested_qty`. `sourceLocationId` may be set here if still null. | from + OWNER/ADMIN |
| POST | `/api/stock-transfers/:id/reject` | `{ expectedVersion, reason? }` | `REJECTED`. Optional `reject_reason` stored. | from + OWNER/ADMIN |
| POST | `/api/stock-transfers/:id/cancel` | `{ expectedVersion, reason? }` | `CANCELLED`. Optional `cancel_reason` stored. | requester or from OWNER/ADMIN; only REQUESTED/APPROVED |
| POST | `/api/stock-transfers/:id/ship` | `{ expectedVersion, lines: [{ id, sourceLocationId? }] }` | `SHIPPED`. `shipped_qty = approved_qty`. Unique line ids; ≥1 positive line. `sourceLocationId` required only when `approved_qty > 0`. Zero-approved lines: `shipped_qty = 0`, no ledger. 422 if a positive line is omitted or would ship partial. | from membership |
| POST | `/api/stock-transfers/:id/receive` | `{ expectedVersion, idempotencyKey, lines: [{ id, receiveQty, destLocationId }] }` | `SHIPPED` or `COMPLETED`, **same serializer** (dest-only must not see source bin) | to membership. First receive freezes `dest_location_id`; later `destLocationId` must match. `receiveQty > 0`; unique line ids; ≥1 line. |
| POST | `/api/stock-transfers/:id/return` | `{ expectedVersion, idempotencyKey, lines: [{ id, returnQty }] }` | `SHIPPED` or `COMPLETED`, **same serializer** | to, or from OWNER/ADMIN. `returnQty > 0`; unique line ids; ≥1 line. |

### Modified endpoints

| Method | Route | Change |
|--------|-------|--------|
| Operational lists/creates (planner, board, bays, stock, ATP, workshop/sales/vehicle/PO) | Scope to `SiteContext.getSiteId()`. Reject `siteId` query. `422 ACTIVE_SITE_REQUIRED` when active site missing/invalid. |
| `GET /api/customers/:id`, `GET /api/vehicles`, `GET /api/vehicles/:id` | Nested site-owned histories use `listAcrossAuthorizedSites()` (ruling 44). Dealer-stock `location_id` / lot / `stock_status` / dealer `inventory_role` omitted unless authorized for that lot site (ruling 48). Invoices stay tenant-wide. |
| `GET /api/vehicle-stock/:id` | Missing/invalid SiteContext → **422 `ACTIVE_SITE_REQUIRED`**. Valid context + lot site ≠ active site (or unknown id) → **404**. Nested `purchases` / `sales` / `workshop_orders` may use the authorized-sites helper. |
| PATCH workshop/sales/vehicle/PO | Site change only inside the state machine; **target membership required**; 409 stale; 422 past boundary; atomic retarget. |
| `GET`/`PUT /api/workshop/settings` | Stay this route (`WorkshopController`). Read/write **current site** hours/timezone/slot/holiday country, not a tenant singleton. Table drop is contract-phase only (ruling 56). |
| `POST /api/auth/switch-tenant` | Uses the shared tenant-change helper: atomically set `active_tenant_id` and **`active_site_id = null`**. Never auto-pick. Emit `site_context_updated` `{ siteId: null }` to `user_{firebaseUid}` plus existing `auth:claims_updated`. |
| `AuthSessionService.ensureActiveMembership` | Same helper when auto-repairing `active_tenant_id` (must not write tenant id alone). |
| `TenantMemberService` invite/create auto-assign | Same helper when a user has no `active_tenant_id` (ruling 11). |
| `TenantMemberService.syncUserClaims` | Same helper when reconciling `active_tenant_id` to another membership or `null` (membership-deactivation path). |
| `PATCH` tenant-member `is_active=false` | Emit `site_access_scope_updated`; if that tenant is `active_tenant_id`, run the helper (null `active_site_id`, `site_context_updated`). |
| `PATCH /api/vehicle-stock/:vehicleId` `location_id` | Same-site `vehicle_lot` only (ruling 40). Requires `expectedLocationId`. Cross-site lot → 422; use `POST .../move-site`. Stale source → 409. |
| `POST /api/vehicle-purchases/:id/receive` | **422** unless `location_id` is a `vehicle_lot` of the purchase’s site. Composite FK as ruling 40. Never write `Vehicle.stock_status = ON_ORDER`. |
| Location disable / soft-delete / hard-delete | **409** while a non-`SOLD` dealer vehicle references the lot, or while outstanding transfer qty references the location (rulings 31, 34, 45). `VehicleLot` `onDelete: Restrict`. |
| Operational creates / receipts / transfer writes / document site PATCH / vehicle move | Recheck target `Site.is_active` under the site-row lock (ruling 41). Inactive target → 422. |

### OpenAPI Regeneration

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

### Layout & Actions

- [ ] Page-level actions top-right; title/breadcrumbs top-left.
- [ ] `text-2xl font-semibold tracking-tight` headers; subtitle `text-slate-500`.

### Site switcher

- Header control: current site name, dropdown of `GET /me/sites` (**active sites only**, ruling 47). Hide the **normal** switcher chrome only when the user has exactly one active grant **and** that site is already `active_site_id`. If `active_site_id` is **null** (tenant switch, membership revoke, site deactivation) even with a single remaining grant, show a **recovery prompt/action** that explicitly `PATCH /me/active-site` to that site. Operational APIs still return `ACTIVE_SITE_REQUIRED` until that PATCH. Recovery APIs (`GET /me/sites`, `PATCH /me/active-site`) always exist. After deactivating the last listed site, the recovery list is empty.
- After switch: `site_context_updated` on `user_{firebaseUid}` drives **all** tabs to leave/join site rooms and invalidate site-scoped TanStack keys. Catalog/customer/employee queries stay.
- After **tenant** switch: same event with `siteId: null`; site switcher empty until the user picks a site in the new tenant.

### Settings

- OWNER/ADMIN: Legal entities, sites, memberships (tenant-wide settings area). Hours/holidays edited on the **site** (or settings scoped to the active site).
- Deactivate Site / Legal Entity controls must surface the 422 guard (open transfers, stock, parked vehicles, active sites) rather than silently toggling.

### Transfers

- List: transfers touching any site the user belongs to. Invalidated via **`user_{firebaseUid}`** transfer events **and** `site_access_scope_updated` on membership revoke (including non-active sites). Do not join every membership’s site room. List/detail/**receive/return** **hide source bin** for dest-only members.
- Detail: `GET /api/stock-transfers/:id`. Source-bin fields absent unless the session has from-site membership. Create and action POSTs use the same serializer.
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
- [ ] `site_access_scope_updated` on any membership revoke, including a site that is not `active_site_id`, and on `TenantMember.is_active=false`.
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
- [ ] Invite/create that auto-assigns `active_tenant_id` and `syncUserClaims` membership-deactivation both go through the same helper (null `active_site_id` in the same write).
- [ ] Guard (static rule or test): no production service writes `User.active_tenant_id` except through the helper.
- [ ] Deactivating the **active `TenantMember`** while another tenant membership exists: `ensureActiveMembership` (and the deactivate write) nulls `active_site_id` in the same tenant-change helper; leftover previous-tenant site would violate the composite FK. Emits `site_context_updated` and `site_access_scope_updated`.
- [ ] Transfer fan-out skips a user whose `TenantMember` is inactive even if `SiteMembership.is_active` is still true.
- [ ] Membership revoke that matches `active_site_id` nulls it atomically.
- [ ] Membership revoke of a **non-active** site still emits `site_access_scope_updated` (transfer list / directory caches drop).
- [ ] Tenant-wide catalog/customer remain visible after a site switch.
- [ ] Cross-site: Wien planner does not return München orders; Wien ATP does not count München on-hand.
- [ ] Workshop site change while `SCHEDULED` retargets bay; `INTAKE` → 422; concurrent INTAKE vs site PATCH → one 409.
- [ ] Sales `CONFIRMED`, vehicle purchase `RECEIVED`, vehicle sale `INVOICED` freeze site.
- [ ] Vehicle sale site PATCH when the lot is the other site → 422 (requires `POST /api/vehicle-stock/:id/move-site`, not a document edit).
- [ ] `PATCH /api/vehicle-stock/:id` with a **other-site** (including other-GmbH) `vehicle_lot` → 422; same-site lot with matching `expectedLocationId` → 200 and `AuditLog`. Stale `expectedLocationId` → 409.
- [ ] `POST /api/vehicle-stock/:id/move-site` same-GmbH with membership on both sites → 200; missing target membership, cross-GmbH, inactive site, or `SOLD` vehicle → 422. Stale `expectedLocationId` → 409.
- [ ] Concurrent `move-site` vs `move-site`, vs `VehicleSale` finalize/site PATCH, vs site `is_active=false`: one 409/422.
- [ ] `VehiclePurchase` receive without a `vehicle_lot` on the purchase site → 422. Two historical purchases for one VIN do not make parked-site ambiguous; parked site is the lot.
- [ ] Migration: dealer vehicle with null location is assigned `MAIN` `LOT`; remaining null/non-lot parked rows fail the contract. A persisted `ON_ORDER` `Vehicle` fails the migration (not assigned a lot).
- [ ] Writing `Vehicle.stock_status = ON_ORDER` is rejected; draft purchases still appear as `ON_ORDER` on the stock list via the purchase DTO.
- [ ] Soft-delete/disable/hard-delete of a `vehicle_lot` while an `IN_STOCK` (or `RESERVED`/`IN_PREP`) dealer vehicle references it → 409. `onDelete: Restrict` rejects a raw location delete. After the vehicle is `SOLD` or moved off the lot, delete proceeds (subject to children/stock/transfer guards).
- [ ] Dest-only transfer request: 201 without source bin; site directory returns Wien **name** but not Wien bins; GET source locations of from-site → 403/404; cannot set `sourceLocationId`.
- [ ] Dest-only `GET /api/stock-transfers/:id` (and list) of an **approved/shipped** transfer: `sourceLocationId` and source-bin details absent/null; `fromSiteId` still present. From-member sees the source bin. Missing both memberships → 404. Dest-only user-room realtime payload is likewise redacted.
- [ ] Dest-only `POST` receive and return of a shipped transfer: response omits `sourceLocationId` / source-bin details. Same-key idempotent replay is also redacted (not the raw stored `response_body`).
- [ ] Wien-only `GET /api/customers/:id` and `GET /api/vehicles/:id` omit München `sales_orders` / `workshop_orders` (and matching counts). Dual-membership caller sees both via the authorized-sites helper.
- [ ] Wien-only `GET /api/vehicles` / `GET /api/vehicles/:id` / customer `vehicles` omit `location_id`, lot/site, `stock_status`, and dealer `inventory_role` for a München-parked stock car; VIN/make/customer remain. Authorized lot-site member sees those operational fields.
- [ ] `GET /api/vehicle-stock/:id` with no valid active site → 422 `ACTIVE_SITE_REQUIRED` (not 404).
- [ ] `GET /api/vehicle-stock/:id` for a vehicle whose lot is the other site → **404** even if the caller has that other site’s membership (active site must match). Nested histories on a matching-site stock detail may include authorized-sites workshop/purchase/sale rows.
- [ ] Sales/PO/vehicle site PATCH without target membership → 422 (directory ID is not enough).
- [ ] Same-GmbH full ship then partial receive/return; `received + returned ≤ shipped`; mixed receive/return ends `COMPLETED` not `RECEIVED`. Ship omitting a positive line or `shipQty < approved_qty` → 422. Zero-`approved_qty` line ships with `shipped_qty = 0`, no `sourceLocationId`, no ledger pair.
- [ ] Receive/return with `receiveQty`/`returnQty` `<= 0`, empty `lines`, duplicate line ids, or `requested_qty <= 0` on create → 400/422; no ledger write.
- [ ] `POST /api/stock-transfers` omitted `lines` or `lines: []` → 400. Approve omitted `lines` expands to all requested qtys; approve `lines: []` → 400.
- [ ] Second partial receive with a **different** `destLocationId` → 422; same frozen dest → 200.
- [ ] Soft-delete/disable of the **frozen dest bin** while `shipped_qty > received + returned` (even after received stock was moved out and dest on-hand is 0) → 409.
- [ ] Cross-GmbH create/approve/ship → 422.
- [ ] Ship blocked when `approved_qty` > `on_hand - reserved`.
- [ ] Tenant with **no** `WorkshopSettings` row backfills `Europe/Vienna`, `30`, `AT`, and `DEFAULT_OPENING_HOURS` (Saturday `08:00`–`12:00`, Sunday closed — not seven open `07:30`–`17:00` days).
- [ ] Tenant with `holiday_country_iso = CH` (or other non-AT/DE): `LegalEntity.country_iso = AT`, `Site.holiday_country_iso = CH`; migration succeeds.
- [ ] Two sites can share the same `workshop_holidays.observed_on`; the old unique `(tenant_id, observed_on)` is gone.
- [ ] Tenant with **partial** opening-hour rows (e.g. Mon–Fri only) ends with exactly seven weekday rows; missing days come from `DEFAULT_OPENING_HOURS`.
- [ ] Partial receive retry with same `idempotencyKey` **and** body is a no-op even across API instances (durable `stock_transfer_commands` row); same key different body → 409; stale `expectedVersion` on a **new** key → 409.
- [ ] **Simultaneous** same-key receive from two instances: one commits; the loser re-reads the command and returns the stored result (not OCC 409).
- [ ] Transfer dual-room: Wien and München **site** sockets both get the event; a third site does not. A Salzburg-active user who is a Wien member gets the event on **`user_{firebaseUid}`** (transfer list), not Wien planner events. Emitting to `user_{User.id}` must not be treated as success.
- [ ] Line insert with `source_location_id` of the to-site (or dest of the from-site) is rejected by the composite FK.
- [ ] Ledger insert with `site_id` = Wien and `location_id` of a München bin is rejected by `(tenant_id, site_id, location_id)`.
- [ ] Receive pair: `TRANSFER_OUT` (from-site in-transit) has `site_id = from_site_id`; `TRANSFER_IN` dest bin has `site_id = to_site_id`. Return OUT is from-site; IN is from-site source bin.
- [ ] Transfer number is assigned at create from `finance_settings.next_stock_transfer_number` / literal `stock_transfer_prefix` (default `TR-2026-`, upsert `` `TR-${currentYear}-` ``); unique `(tenant_id, transfer_number)`; tenant-wide (two sites share one series). Concatenation only — no `{YYYY}` interpolation in the column.
- [ ] `GET /api/sites?includeInactive=true` as OWNER/ADMIN with **no** `SiteMembership` returns inactive sites (full rows). Default `GET /api/sites` without the flag stays names-only active and membership-gated.
- [ ] `GET /api/legal-entities` includes an inactive entity; `includeInactive=false` omits it.
- [ ] New `legal_entities` / `sites` / `site_memberships` / `stock_transfers` / `stock_transfer_lines` rows have `createdAt`/`updatedAt`. Approve/ship/receive set the matching `*_by_user_id`. Reject/cancel persist optional `reason`.
- [ ] `stock_transfer_commands` persist `createdAt`; completing a transfer does not delete command rows.
- [ ] `GET`/`PUT /api/workshop/settings` remain those routes and read/write the **current site**. Expand still has `workshop_settings`; contract drops the table.
- [ ] Storage-location `parent_id` pointing at another site’s aisle is rejected by `(tenant_id, site_id, parent_id)`.
- [ ] Second socket for the same user leaves the old site room after `site_context_updated`.
- [ ] `PATCH` site `is_active=false` with a `SHIPPED` transfer, `WorkshopOrder` `COMPLETED` (not invoiced), `SalesOrder` `CONFIRMED`, `PurchaseOrder` `SENT`, on-hand qty, or an `IN_STOCK` vehicle on a site lot → 422.
- [ ] Concurrent site `is_active=false` vs workshop create, PO goods receipt, transfer create, document site PATCH, or vehicle `move-site`: one 409/422; the deactivated site does not gain new live work.
- [ ] Transfer/`move-site`/document PATCH targeting an inactive site → 422.
- [ ] `PATCH` site `is_active=false` allowed when remaining docs are only `WorkshopOrder` `INVOICED`, `SalesOrder` `INVOICED`, `PurchaseOrder` `COMPLETED`, `VehiclePurchase` `RECEIVED`/`CANCELLED`, `VehicleSale` `INVOICED`/`CANCELLED`, `StockTransfer` `COMPLETED`/`REJECTED`/`CANCELLED`, stock qty is zero, **and no non-`SOLD` dealer vehicle’s lot is at the site**.
- [ ] `PATCH` legal entity `is_active=false` while it still has an active site → 422.
- [ ] `POST /api/sites` and `PATCH is_active=true` against an inactive `LegalEntity` → 422.
- [ ] `POST /api/sites/:id/memberships` for a user with no `TenantMember` in that tenant → 422 (composite FK).
- [ ] In-transit location absent from location pickers; direct delete 409; source bin disable blocked while outstanding.
- [ ] Concurrent site-switch vs document commit: guarded transaction decides the winner.
- [ ] `GET /api/me/sites` after deactivating a site omits that site even though the `SiteMembership` row remains; `PATCH /me/active-site` to it → 422.

### Frontend

- [ ] Visual QA: switcher, two-site planner, transfer request without source bin, receive remaining qty.
- [ ] After switch, board/stock refetch; customer list does not flash empty.
- [ ] After tenant switch (or membership revoke) with **exactly one** remaining site grant and `active_site_id` null, the recovery control is visible and `PATCH /me/active-site` restores the site; the normal chrome stays hidden only once that site is already active.
- [ ] After site deactivation, recovery/`GET /me/sites` does not list the inactive site.

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
- ADR-0009: Sequential numbering (`TR-{YYYY}-{XXXX}` tenant-wide at transfer create)
- ADR-0011: Atomic status transition guards
- ADR-0019: Workshop planner calendar — hours/holidays/timezone/slot move from tenant `WorkshopSettings` onto `Site`
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
