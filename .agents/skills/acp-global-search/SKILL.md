---
name: acp-global-search
description: Use when adding, modifying, or reviewing a global search (Cmd+K) entity type or provider in ACP (apps/core-api/src/search/, apps/core-web/src/components/global-search/, pg_trgm GIN indexes, or docs/internal/02-Feature-Specs/Search/global-search.md).
---

# ACP Global Search (Cmd+K)

How to add or extend an entity type in ACP's global search (`GET /api/search` + Cmd+K palette). Load this skill before touching `apps/core-api/src/search/` or `apps/core-web/src/components/global-search/`.

## Architecture

### Backend (`apps/core-api/src/search/`)
- `search.types.ts`: `SEARCH_RESULT_TYPES` tuple (drives DTO validation and OpenAPI enum), `SearchResultType`, `SearchProvider`, `SearchContext`, `SearchResult`, `SiteScope`.
- `search-providers.ts`: `createSearchProviders(prisma)` registry. **Array order = group order** in the API response and Cmd+K palette.
- `providers/*-search.provider.ts`: one `SearchProvider` implementation per entity type.
- `search.service.ts`:
  - `SearchController.search` (`search.controller.ts`) is `@MechanicAccessible()` (`EVERY_ROLE` in ADR-0034). **The real role gate is `SearchService.selectProviders`**, which filters by `provider.allowedRoles`.
  - Resolves `tenantId` from `TenantContextService` and `SiteScope` lazily via `SiteContextService`.
  - Runs selected providers via `Promise.allSettled`, sorts active-site hits first, and logs only `type` + error class on failure (never the query, names, or titles).
- `search-ranking.ts`: `collectMatches`, `collectSiteRanked`, `tierFilter`, `tiersFor` (`exact` = 1, `prefix` = 0.8, `contains` = 0.5; escapes `%`, `_`, `\\`).

### Frontend (`apps/core-web/src/components/global-search/`)
- `global-search-types.ts`: `SEARCH_TYPE_REGISTRY` mapping every `SearchResultType` to `{ icon, labelKey, prefix }` (`nav:globalSearch.groups.*` and `<prefix>:` filter).
- `global-search-record-route.ts`: `parseGlobalSearchRecordRef` for Cmd+K contextual actions when opened on a record detail route.
- `apps/core-web/src/lib/app-route-paths.ts`: `APP_ROUTE_PATHS` — every provider `href` must resolve to a real frontend route.

### Translations & Spec
- `locales/{de,en}/nav.json` under `globalSearch.groups.*` (follow `.agents/skills/acp-i18n/SKILL.md`; German `de-AT` is the source of truth).
- `docs/internal/02-Feature-Specs/Search/global-search.md`: feature spec for matching, role matrix, site rules, and known limits.

---

## Step-by-step: adding a new search type

1. **Register the type key**
   Add the new snake_case key to `SEARCH_RESULT_TYPES` in `apps/core-api/src/search/search.types.ts`.

2. **Ensure `pg_trgm` GIN indexes exist**
   Every text column queried with `ILIKE` (`equals`, `startsWith`, `contains` with `mode: 'insensitive'`) must have a `gin_trgm_ops` GIN index.
   - Check `apps/core-api/prisma/migrations/20261022182000_aut661_search_trgm_indexes/migration.sql` and subsequent migrations first.
   - If any searched column lacks one, add a **new** expand-only Prisma migration (following `20261022182000_aut661_search_trgm_indexes` — **never** edit an existing migration):
     ```sql
     CREATE INDEX "<table>_<column>_trgm_idx" ON "<table>" USING GIN ("<column>" gin_trgm_ops);
     ```
   - Add the new index name and column probe to `apps/core-api/test/aut661-search-trgm-indexes.e2e-spec.ts`.

3. **Implement `providers/<entity>-search.provider.ts`**
   - **Tenant isolation (mandatory):** Always include `tenant_id: ctx.tenantId` on the root `where` AND on every nested relation filter (`customer: { ...customer, tenant_id: ctx.tenantId }`). Never trust any tenant ID other than `ctx.tenantId`.
   - **Role gating (ADR-0034):** Set `readonly allowedRoles` explicitly (e.g. `['OWNER', 'ADMIN', 'SALES', 'DEMO']`, adding `'TECH'` only if mechanics may see the entity). Because `SearchController.search` is `EVERY_ROLE`, `allowedRoles` is the sole role gate. If `'TECH'` is allowed and the entity links to customer contact data, redact email/phone from both `where` and `select` when `ctx.role === 'TECH'`.
   - **Site scope (ADR-0022):**
     - *Tenant-wide model* (no `site_id`): use `collectMatches`, omit `siteId` from `SearchResult`.
     - *Site-scoped document* (e.g. `workshop_order`, `invoice`): use `collectSiteRanked(ctx.limit, await ctx.getSiteScope(), ...)` with `site_id: { in: siteIds }`, return `siteId` on `SearchResult`. Fails closed when `siteIds` is empty.
     - *Active-site-only model* (e.g. `stock_vehicle`): verify `activeSiteId && siteIds.includes(activeSiteId)`, filter `site_id: activeSiteId`, return `siteId`.
   - **Never search sensitive or encrypted columns:** Never query or select `iban`, `bic`, `*_encrypted`, `*secret*`, `password`, `token`, or personal data such as `birth_date` / `date_of_birth` or `tax_id`.
   - **Query shape:** Use `findMany` only (never `count`, `aggregate`, `groupBy`, or `$queryRaw`), `select` only (never `include`), `take: ctx.limit`, and `orderBy` ending in `{ id: 'asc' }`.
   - **Result shape:** Return `{ type, id, title, subtitle, href, score, ...(siteId ? { siteId } : {}) }` where `title` is the primary identifier/name, `subtitle` gives context/status (or `null`), and `href` matches a route in `APP_ROUTE_PATHS`.

4. **Register the provider**
   Add `new <Entity>SearchProvider(prisma)` to `createSearchProviders` in `apps/core-api/src/search/search-providers.ts` in the desired group display order.

5. **Regenerate OpenAPI & frontend API types**
   ```bash
   npm --prefix apps/core-api run openapi:generate
   npm --prefix apps/core-web run api:types:generate
   ```
   Commit both generated files (`apps/core-api/openapi/openapi.json` and `apps/core-web/src/api/generated/openapi.ts`).

6. **Add i18n keys (`locales/{de,en}/nav.json`)**
   Add the group label under `globalSearch.groups.<camelCaseKey>` in **both** `locales/de/nav.json` and `locales/en/nav.json` (German `de-AT` first, identical key order) per `.agents/skills/acp-i18n/SKILL.md`.

7. **Wire the frontend registry**
   - Add an entry to `SEARCH_TYPE_REGISTRY` in `apps/core-web/src/components/global-search/global-search-types.ts` with a Lucide `icon`, `labelKey: 'nav:globalSearch.groups.<camelCaseKey>'`, and `prefix`.
   - If the entity's detail page should expose Cmd+K record context actions, add its route to `parseGlobalSearchRecordRef` in `apps/core-web/src/components/global-search/global-search-record-route.ts`.

8. **Update docs and guard-test fixtures**
   - Update `docs/internal/02-Feature-Specs/Search/global-search.md` (summary, group order, matching table, role matrix, site rule).
   - Add the new type's fixture entries to the registry-driven maps in:
     - `apps/core-api/src/search/search-providers.spec.ts`
     - `apps/core-api/test/search.e2e-spec.ts`
     - `apps/core-api/test/aut661-search-trgm-indexes.e2e-spec.ts`

---

## Umlauts, `ß`, and accent folding

- **German umlauts (`ä`, `ö`, `ü`)**: Postgres `ILIKE` (`mode: 'insensitive'`) matches umlauts case-insensitively (`"MÜLLER"` finds `"Müller"`).
- **Sharp s (`ß`)**: Postgres `ILIKE` does **not** fold `ß` to `ss` (`"strasse"` does **not** match `"Straße"`).
- **Accent folding (`unaccent`)**: Not in place today (e.g. `"Cafe"` does not match `"Café"`). Do not claim accent folding in specs or UI copy.

---

## Verification

Run these checks before pushing (see `agents.md` for DB setup):

```bash
# 1. Backend unit guards (registry, tenant/role/sensitive-column checks)
npm test --workspace=core-api -- --ci --runInBand src/search/search-providers.spec.ts src/search/search.service.spec.ts

# 2. Frontend unit + i18n parity
npm test --workspace=core-web -- src/components/global-search/
npm run i18n:check

# 3. Backend search + trigram EXPLAIN e2e (fresh migrated auto_core_test DB)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core_test" \
  npm run test:e2e --workspace=core-api -- --ci --runInBand \
  test/search.e2e-spec.ts test/aut661-search-trgm-indexes.e2e-spec.ts
```
