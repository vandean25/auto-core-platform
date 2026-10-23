---
title: "Global Search (backend)"
date: "2026-10-23"
module: "Search"
status: draft
linear-project: "N/A"
linear-milestone: "N/A"
tags:
  - feature-spec
  - search
  - multi-tenancy
---

# Global Search (backend)

## Summary

> `GET /api/search` replaces the command palette's separate requests with one call. It returns grouped, ranked results for six entity types, isolated by tenant, filtered by session role on the server, ordered by site and tolerant of a single failing type. The palette switch is a separate frontend ticket (AUT-663).

---

## Endpoint

`GET /api/search?q=&types=&limit=`

| Param | Rule |
|---|---|
| `q` | Trimmed. At least 2 characters; a purely numeric input may be 1 character. At most 100. |
| `types` | Optional, comma-separated subset of the six types. Types the session role may not see are dropped silently. |
| `limit` | Results per type. Default 5, maximum 10. |

The route is `@MechanicAccessible()`, so TECH sessions get `200` with their restricted types instead of `403`.

## Result format

```json
{
  "groups": [
    {
      "type": "customer",
      "results": [
        { "type": "customer", "id": "…", "title": "…", "subtitle": "…", "href": "/customers/…", "score": 0.8, "siteId": "…" }
      ],
      "error": "unavailable"
    }
  ]
}
```

- Groups follow the provider registry order: `customer`, `vehicle`, `stock_vehicle`, `workshop_order`, `invoice`, `part`.
- `siteId` is set only for site-scoped types. `error: "unavailable"` appears only on a group whose provider failed (its `results` is empty); the other groups are unaffected.
- Order inside a group: active-site hits first, then `score` descending, then the provider's database order (which always ends in `id`).

## Matching

The parser classifies the trimmed input (first match wins): `uuid`, `email` (contains `@`), `vin` (17 characters, ISO 3779 charset, at least one letter), `phone` (6+ digits, starts with `+` or `0`), `number` (digits only, or 2+ letters, a dash and a digit later, like `RE-2026-0012`), `plate`, `name`. Independently of the kind, a plate-shaped input keeps its normalised plate (`AB-123` is a `number` and a plate) and an input of 6 to 17 VIN-charset characters keeps an upper-cased VIN fragment.

Each provider runs three parallel queries against the trigram indexes from AUT-661 (`ILIKE`, `take: limit`, `select` only):

| Tier | Filter | Score |
|---|---|---|
| exact | `equals` (case-insensitive) | 1 |
| prefix | `startsWith` | 0.8 |
| contains | `contains` | 0.5 |

`%`, `_` and `\` typed by the user are escaped, so they are literal characters. The best tier wins per entity; there is no `count()` anywhere.

Two fields are narrower than the tiers: an email is looked up exact and as prefix only (no contains), and a plate is matched on `vehicles.plate_normalized` exact and prefix only (no contains), so the btree index `(tenant_id, plate_normalized)` serves it. A VIN fragment uses the same three tiers, with the contains tier being a suffix match (`endsWith`).

| Type | Matches |
|---|---|
| customer | uuid → id; email; phone; name words (each word must hit first name, last name or company name, in any order) |
| vehicle | `inventory_role = CUSTOMER`. `plate_normalized`, VIN fragment (prefix/suffix, exact when full), make/model words |
| stock_vehicle | Dealer roles with a `stock_status`, same matching as vehicle |
| workshop_order | order number, uuid, vehicle (plate/VIN/make/model), customer (name/email/phone) |
| invoice | invoice number, uuid, vehicle, customer. Only issued invoices (those with a number) |
| part | SKU, name words, uuid |

The plate normaliser is shared with the vehicle import (`vehicle/vehicle-plate.util.ts`): whitespace, hyphens and dots are removed and letters upper-cased. `vehicles.plate_normalized` holds `normalizePlate(plate)`. The migration backfills it with an equivalent SQL expression (an e2e test runs the migration statement and `normalizePlate` on the same sample plates), and every write path that sets `plate` goes through `withPlateNormalized`: `VehicleService` create/update (via the persistence service), the dealer stock lot payload (purchase receive), workshop intake and registration intake, the vehicle import, and the seed fixtures.

The backfill upper-cases with the database's `UPPER`, which follows the database locale for non-ASCII letters (and keeps a sharp s that JS turns into `SS`); plates are ASCII in practice. A vehicle written by an old instance during a rolling deploy can have a NULL `plate_normalized` until it is next edited; re-running the backfill `UPDATE ... WHERE plate_normalized IS NULL` closes that.

Known gap: phone numbers match the stored formatting only (as typed, or without separators). There is no normalised phone column; a follow-up ticket covers it.

## Role matrix

| Role | customer | vehicle | stock_vehicle | workshop_order | invoice | part |
|---|---|---|---|---|---|---|
| OWNER, ADMIN | yes | yes | yes | yes | yes | yes |
| SALES | yes | yes | yes | yes | yes | yes |
| TECH | name only | yes | – | yes | – | – |
| DEMO | like SALES (read-only) | | | | | |

TECH customer results carry only `id`, a name `title`, `href` and an empty `subtitle`; email and phone are never selected, and email/phone input finds no customer. Any other role (service or API key principals) receives no groups.

## Site rule (ADR-0022)

- `tenant_id` comes only from the tenant context.
- Site-scoped types (`workshop_order`, `invoice`) return the active site's hits first and hits of the caller's other authorized sites after, with `siteId`. Authorized sites are active `SiteMembership` joined to an active `TenantMember`; no request parameter is read. Rows without a `site_id` are not returned.
- `stock_vehicle` is visible for the active site only, like `GET /api/vehicle-stock/:id`.
- `vehicle`, `customer` and `part` are tenant-wide (no `site_id`).
- If the site scope cannot be resolved, site-scoped types return nothing (fail closed).

## Providers

Providers sit behind the `SEARCH_PROVIDERS` injection token (`createSearchProviders`). Each declares `allowedRoles`; `SearchService` filters by the session role and runs the rest with `Promise.allSettled`. A failing provider is logged with its type and error class only. Neither the query, nor names, emails, phone numbers or titles are logged.

## Database Impact

`vehicles.plate_normalized` (nullable `TEXT`) with a btree index on `(tenant_id, plate_normalized)`; expand-only migration with a backfill from `plate`. No other schema change.

### Deletion Policy Impact

None. The endpoint is read-only.
