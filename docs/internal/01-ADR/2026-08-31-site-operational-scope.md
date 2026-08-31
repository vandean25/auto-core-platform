---
title: "ADR-0022: Site Is Request-Scoped Operational Ownership (ADR-0013 Unchanged)"
date: "2026-08-31"
status: proposed
deciders: "Product Owner, Architecture Team"
linear-project: ""
linear-milestone: ""
tags:
  - adr
  - tenancy
  - site
  - legal-entity
  - realtime
  - inventory
---

# ADR-0022: Site Is Request-Scoped Operational Ownership (ADR-0013 Unchanged)

## Status

**Proposed** — 2026-08-31

Product design for Multi-Location slice 1 (planner + stock + same-GmbH transfers) is locked. Nest/React starts only after the Feature Spec is approved and issues are cut.

## Context

ACP isolates customers with a universal `tenant_id` column and a Prisma Client extension that injects that filter (ADR-0013). That boundary is **hard security**: a mechanic at Workshop A must not read Workshop B.

We now need **several physical sites and several legal entities inside one tenant** (Wien / München, AT GmbH / DE GmbH). Three different questions got collapsed in early brainstorming:

| Id | Question | Kind |
|----|----------|------|
| `tenant_id` | Which customer owns this row? | Security (automatic) |
| `site_id` | Which shop’s planner/warehouse is this? | Operational ownership |
| `legal_entity_id` | Which GmbH will (later) issue the Rechnung? | Fiscal (thin now) |

Putting all three through the same generic Prisma extension would make tenant-wide master data (catalog, customers, employees) an exception list, and would confuse “cannot see another company” with “cannot see the other stall”.

Legal Invoicing is **paused** until Site + Legal Entity exist. Transfers still need `legal_entity_id` today so Wien→München cannot be treated as a warehouse move when those shops are different GmbHs.

## Decision

**Retain ADR-0013 unchanged as the automatic tenant-security boundary. Introduce site as an authenticated request context and an explicit operational scope, backed by persisted document ownership and domain-specific invariants. Legal Entity is a thin tenant-scoped record so same-GmbH rules can run now and invoicing can attach later without a tenancy redesign.**

### 1. Models

- `LegalEntity` — `tenant_id`, name, `country_iso` (`AT` \| `DE`), `is_active`. No tax IDs in this ADR. Deactivation blocked while the entity has any active `Site`. Site create and `is_active=true` require the parent entity to be active (no atomic dual reactivation in slice 1). Backfill: non-AT/DE `WorkshopSettings.holiday_country_iso` maps `LegalEntity.country_iso` to **`AT`**; the original code stays on `Site.holiday_country_iso`.
- `Site` — `tenant_id`, **immutable** `legal_entity_id`, code, name, nullable address, planner hours fields, `is_active`. N:1 sites per entity. Deactivation `SELECT … FOR UPDATE`s the site row, then rechecks live enum terminals (`WorkshopOrder` `INVOICED`; `SalesOrder` `INVOICED`; `PurchaseOrder` `COMPLETED`; `VehiclePurchase` `RECEIVED`/`CANCELLED`; `VehicleSale` `INVOICED`/`CANCELLED`), transfers `COMPLETED`/`REJECTED`/`CANCELLED`, on-hand/reserved/in-transit qty zero, **and no non-`SOLD` dealer vehicle whose lot is at the site**. Creates, receipts, transfers, retargets, and vehicle moves recheck `is_active` under that same site-row lock (two-site ops: globally sorted site ids).
- `SiteMembership` — user ↔ site, `is_active`. Access only; not an `Employee` home site. `OWNER`/`ADMIN` remain `TenantMember` roles. Composite FK `(tenant_id, user_id) → TenantMember (tenant_id, user_id)`. **Authorization and realtime fan-out also require `TenantMember.is_active`**; the FK only proves the row exists.
- `User.active_site_id` — nullable. Valid only when it belongs to `active_tenant_id`, the site is active, and an active membership exists. Composite FK `(active_tenant_id, active_site_id) → Site (tenant_id, id)`. **Every write that changes `active_tenant_id`** (`switchTenant` and `ensureActiveMembership`) uses one helper that also sets `active_site_id = null`.
- `StockTransfer` — unique `(tenant_id, id)` so lines, ledger rows, and command rows can use tenant-safe composite FKs. Also unique `(tenant_id, id, from_site_id, to_site_id)`.
- `StockTransferLine` — copies immutable `from_site_id` / `to_site_id` from the parent; source/dest location FKs are `(tenant_id, from_or_to_site_id, location_id) → StorageLocation (tenant_id, site_id, id)`.
- `StockTransferCommand` — durable receive/return idempotency. Unique `(tenant_id, transfer_id, action, idempotency_key)`. Written in the same transaction as counters and ledger pairs.

Every new model stays tenant-scoped. Required unique keys so composite FKs compile:

- `LegalEntity` and `Site`: `@@unique([tenant_id, id])`
- Site-owned parents (`Bay`, `StorageLocation`, …): `@@unique([tenant_id, site_id, id])`
- `StorageLocation.parent_id`: `(tenant_id, site_id, parent_id) → StorageLocation (tenant_id, site_id, id)`, null for roots
- `InventoryTransaction.location_id`: `(tenant_id, site_id, location_id) → StorageLocation (tenant_id, site_id, id)`
- `StockTransfer`: `@@unique([tenant_id, id])` and `@@unique([tenant_id, id, from_site_id, to_site_id])`
- `SiteMembership`: `(tenant_id, user_id) → TenantMember (tenant_id, user_id)`
- `WorkshopHoliday`: drop `@@unique([tenant_id, observed_on])`; add `@@unique([tenant_id, site_id, observed_on])` and `(tenant_id, site_id) → Site (tenant_id, id)`
- `User.active_site_id` is `(active_tenant_id, active_site_id) → Site (tenant_id, id)`, not a bare FK to `Site.id`

Composite tenant-safe (and site-safe) relations: a site cannot point at another tenant’s legal entity; a Wien order cannot point at a München bay, bin, or lot; a ledger row cannot claim Wien while pointing at a München location; a bin cannot parent under another site’s aisle.

### 2. Request context — not a query parameter

```ts
const tenantId = tenantContext.getTenantId();
const siteId = siteContext.getSiteId();
```

`SiteContextService` is populated from the authenticated session (`User.active_site_id`), never from `?siteId=` or `X-Site-Id`. It requires an active `TenantMember` and an active `SiteMembership`. Operational list/create endpoints that receive `siteId` as a filter return **400**.

`422 ACTIVE_SITE_REQUIRED` is returned **only** from site-dependent operational APIs. `GET /me/sites` and `PATCH /me/active-site` stay available. Switching never auto-selects a site. `PATCH /me/active-site` validates tenant, site, both memberships, and activity in one transaction.

`POST /api/auth/switch-tenant` **and** `AuthSessionService.ensureActiveMembership` share one tenant-change helper: atomically update `active_tenant_id` **and** set `active_site_id = null`. Neither path may write `active_tenant_id` alone (that would violate the composite FK). Never auto-pick a site in the destination tenant. Emit `site_context_updated` `{ siteId: null }` to `user_{firebaseUid}` (switch-tenant also keeps `auth:claims_updated`). `TenantMember.is_active = false` emits `site_access_scope_updated` and, when that tenant is `active_tenant_id`, runs the same helper.

Deleting or deactivating the membership that matches `active_site_id` clears the active site atomically. Any membership grant/revoke/deactivate also emits `site_access_scope_updated` on `user_{firebaseUid}` so transfer-list and site-directory caches drop even when the row was not the active site.

Cross-site operations (transfers, site admin lists, later reports) use **named** methods such as `listAcrossAuthorizedSites()`. Permitted operational IDs come from the caller’s **active `SiteMembership` joined to an active `TenantMember`**. There is **no** generic bypass flag. A **names-only site directory** (id, code, name, legalEntityId) is visible to any such member so a dest-only user can request from a sister site without seeing that site’s bins or on-hand.

### 3. Persisted ownership, not inferred from the switcher

Create stamps `site_id` from `SiteContext`. Later reads use the document column. The user’s current site must not “fix” a Wien invoice or job.

Site changes are **guarded atomic transitions** (ADR-0011): **active membership on the target site is required for every document type**. Stale status/site → **409**; past the boundary → **422**. The site PATCH and the commit transition cannot race.

| Document | Site change allowed | Frozen at |
|----------|---------------------|-----------|
| `WorkshopOrder` | `SCHEDULED` only; retarget bay; clear/revalidate kits/bins | `INTAKE` |
| `SalesOrder` | `DRAFT` | `CONFIRMED` |
| `PurchaseOrder` | `DRAFT` | leaving `DRAFT` |
| `VehiclePurchase` | `DRAFT`; lot must be target site | `RECEIVED` |
| `VehicleSale` | `DRAFT`; parked vehicle’s **lot** must already be on the target site | `INVOICED` |

Same-site lot change uses `PATCH /api/vehicle-stock/:id` with `expectedLocationId`, constrained to the vehicle’s current lot site. Cross-site same-GmbH uses `POST /api/vehicle-stock/:id/move-site` with membership on both sites, `expectedLocationId`, and both sites `is_active`; cross-GmbH is 422. Stale source lot → 409. Lock order: sorted site ids, then vehicle, then sale. Parked site is **lot-only**; `VehiclePurchase.RECEIVED` requires a site-safe `vehicle_lot`. `PATCH location_id` with a tenant-only location check is not a site contract.

### 4. Do not extend Prisma `$extends` with `site_id`

The tenant extension stays tenant-only. Site-operational models are queried with `{ tenant_id, site_id }` (or a named cross-site helper) in services/repositories. Shared master data has no `site_id` and needs no allowlist.

Guardrails: composite indexes `(tenant_id, site_id)`; cross-site e2e on operational endpoints; tests that tenant-wide rows remain visible after a switch; review/static rule for site-scoped Prisma models.

### 5. Realtime — site rooms on the server

ADR-0001 tenant rooms remain for tenant-wide entities. Operational events emit to **`site:{siteId}`**. Clients join the active site room on connect. The private user room is the existing gateway identity **`user_{firebaseUid}`** (`DashboardGateway.USER_ROOM_PREFIX`; `socket.data.userId` is already the Firebase UID). **`site_context_updated`** on that room forces every socket for that user (all tabs/devices) to leave the old site room and join the new one. Membership revoke of the active site, site deactivation, tenant switch, **and `TenantMember` deactivation** emit the same event with `siteId: null` when the active site is cleared. **`site_access_scope_updated`** fires on any membership change, including a site that is not `active_site_id` and including tenant-membership suspend. Transfer mutations publish to **both endpoint site rooms** and to **`user_{firebaseUid}` of members of from or to who have an active `TenantMember`**, resolving `User.firebaseUid` from `SiteMembership.user_id` — emitting to the relational UUID reaches no socket. Isolation is not “the React client ignores München events.” Do not join every membership site room while viewing one shop’s planner.

### 6. Same-GmbH transfers

`StockTransfer` stores immutable `from_site_id` / `to_site_id`. Lines copy those site ids and constrain source/dest locations with composite FKs to the parent tuple plus `storage_locations (tenant_id, site_id, id)`. Same `legal_entity_id` is checked at create, approve, and ship. Requester needs membership on **either** endpoint; destination-only users cannot choose a source bin. Create UX uses the names-only site directory for from/to pickers, not memberships-only lists. **Ship is one-shot and full** (`shipped_qty = approved_qty`). Source bin required only where `approved_qty > 0`; zero-approved lines have no ledger pair. Qty domains: `requested_qty > 0`; `0 <= approved_qty <= requested_qty`; persisted counters `>= 0`; submitted receive/return qty `> 0`; unique line ids per present payload; create requires ≥1 line (`[]`/omitted → 400). Approve **omitted `lines`** expands to all requested qtys; present `lines: []` is 400. Receive/return require `expectedVersion` **and** `idempotencyKey`, persisted on `StockTransferCommand` (unique `(tenant_id, transfer_id, action, idempotency_key)`), written atomically with counters and ledger. Concurrent same-key losers **re-read the command row** after OCC or unique-key conflict and return the stored response when the hash matches. First receive freezes `dest_location_id`; later receives must match; **that dest bin cannot be disabled/soft-deleted while receipt remains outstanding**. Ledger pairs persist the **applicable** `site_id` with `(tenant_id, site_id, location_id)` onto the location, plus a `movement_group_id`. Cost basis copies through in-transit. Details: Feature Spec.

## Consequences

### Positive

- Customer isolation stays one automatic mechanism (ADR-0013).
- Wien stock and München planner cannot leak through a missing `?siteId=`.
- Legal Invoicing can snapshot `site.legal_entity` later without moving `tenant_id`.
- Sister shops in one GmbH can transfer stock without pretending two companies are one warehouse.

### Negative

- Every operational path must remember `siteContext.getSiteId()`. Tests and review rules have to catch omissions; the ORM will not. Site-owned creates also recheck `Site.is_active` under a site-row lock so deactivation cannot race a new document.
- Existing tenants need an expand/backfill/validate/contract migration before `NOT NULL`.
- Socket.IO gains site rooms plus user-room `site_context_updated` / `site_access_scope_updated` on `user_{firebaseUid}`; transfer fan-out is two site rooms and member user rooms resolved via `User.firebaseUid`.
- `POST /api/auth/switch-tenant` **and** `ensureActiveMembership` must clear `active_site_id` in the same write as `active_tenant_id`.

### Neutral

- Thin `LegalEntity` will grow tax IDs and number series in the Legal Invoicing spec; `Site.legal_entity_id` stays immutable so that growth does not rewrite history.
- HR stays tenant-wide until a later spec.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **A+ Request-scoped site context** | Matches `active_tenant_id`; master data stays simple; documents own their site. | Discipline + tests instead of ORM auto-filter. **Chosen.** |
| **B Site in Prisma `$extends`** | Harder to forget a WHERE. | Catalog/customers/employees become bypasses; two-layer RLS. |
| **C Query-parameter site** | No session column. | Client filter is authorization; missing param leaks. |
| **One tenant per site** | Zero new dimension. | Dual-company / dual-shop customer becomes two SaaS tenants. |
| **1:1 site = legal entity** | Fewer tables. | Second Wien shop under the same GmbH requires a rewrite. |
| **Intercompany transfer in slice 1** | Wien→München “just works”. | Needs a legal Rechnung; pulls paused Legal Invoicing back in. |

## References

- Feature Spec: `docs/internal/02-Feature-Specs/Platform/2026-08-31-multi-location-sites-and-legal-entities.md`
- ADR-0013: `2026-04-15-row-level-multi-tenancy.md`
- ADR-0001: `2026-04-12-prisma-extends-realtime-sync.md`
- ADR-0002: `2026-04-12-ledger-based-inventory.md`
- ADR-0011: `2026-04-12-atomic-status-transition-guards.md`
- ADR-0020: `2026-08-22-hr-time-and-leave.md`
- ADR-0021: `2026-08-28-vehicle-intelligence-catalog-providers.md`
- `docs/deletion-policy.md`

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | None yet. Legal Invoicing Linear project remains paused. |
| Milestone | Slice 1 — planner + stock + same-GmbH transfers |
| Issues | [AUT-249](https://linear.app/auto-core-platform/issue/AUT-249/docs-multi-location-sites-feature-spec-and-adr-0022) |
