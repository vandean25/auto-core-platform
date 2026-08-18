# Runbook: Prisma Raw Query Prohibition

**Status:** Active  
**Enforced by:** AUT-65 — ESLint rule in `apps/core-api/eslint.config.mjs`  
**ADR:** [ADR-0013: Row-Level Multi-Tenancy](../01-ADR/2026-04-15-row-level-multi-tenancy.md)

---

## Why Raw Queries Are Banned

The application enforces row-level multi-tenancy through a Prisma Client Extension (`createTenantIsolationExtension`). Every Prisma operation — `findMany`, `create`, `update`, `delete`, `count`, etc. — automatically has `tenant_id` injected into the query by the extension.

**Raw query methods completely bypass this extension:**

| Banned method | Why |
|---|---|
| `prisma.$queryRaw()` | Executes arbitrary SQL — no tenant_id injection |
| `prisma.$queryRawUnsafe()` | Same, plus SQL injection risk |
| `prisma.$executeRaw()` | Executes arbitrary SQL — no tenant_id injection |
| `prisma.$executeRawUnsafe()` | Same, plus SQL injection risk |

A developer using any of these methods could accidentally read or write data belonging to a **different tenant** without any error or warning.

---

## What to Do Instead

### For data reads — use typed Prisma operations

```typescript
// ❌ Banned
const items = await prisma.$queryRaw<CatalogItem[]>`
  SELECT * FROM catalog_items WHERE sku = ${sku}
`;

// ✅ Correct — tenant_id is injected automatically
const items = await prisma.catalogItem.findMany({
  where: { sku },
});
```

### For data mutations — use typed Prisma operations

```typescript
// ❌ Banned
await prisma.$executeRaw`
  UPDATE invoices SET status = 'FINALIZED' WHERE id = ${id}
`;

// ✅ Correct — tenant_id scoping is guaranteed
await prisma.invoice.updateMany({
  where: { id, status: InvoiceStatus.DRAFT },
  data: { status: InvoiceStatus.FINALIZED },
});
```

### For DDL (schema changes) — use migrations

Raw SQL for **DDL operations** (ALTER TABLE, CREATE INDEX, etc.) is allowed **only** in Prisma migration files (`prisma/migrations/**/migration.sql`). These run outside the application context and are tenant-agnostic by design.

The ESLint rule does **not** apply to `prisma/migrations/`.

---

## ESLint Enforcement

The following selectors are banned via `no-restricted-syntax` in `apps/core-api/eslint.config.mjs`:

- `MemberExpression[property.name='$queryRaw']`
- `MemberExpression[property.name='$queryRawUnsafe']`
- `MemberExpression[property.name='$executeRaw']`
- `MemberExpression[property.name='$executeRawUnsafe']`

CI will fail on any new introduction of these patterns.

---

## Escape Hatch: Cross-Tenant Admin Queries

There are legitimate scenarios requiring cross-tenant access, such as:

- Billing reports across all tenants
- Support tooling (reading a specific record regardless of tenant)
- Data migration scripts

The **approved escape hatch** is a privileged internal service that instantiates a **plain `new PrismaClient()`** without the isolation extension applied:

```typescript
// privileged-admin.service.ts
// This service must undergo separate architectural review before use.
// It MUST NOT be used from any public-facing API endpoint.
const rawClient = new PrismaClient();
const allTenants = await rawClient.tenant.findMany();
```

**Rules for the escape hatch:**
1. Only usable from an internal/admin service explicitly reviewed and approved
2. Must NEVER be accessible from public API endpoints or request-scoped code
3. Must be documented and its usage logged
4. Not in scope for AUT-65 — requires a separate architectural review (see ADR-0013)

---

## CI Pipeline

The ESLint check runs in the **Backend Build and Test** job of `.github/workflows/build.yaml` (`npm run lint`), alongside `lint:prisma-tenant`. `npm run lint` runs ESLint **without** `--fix`, so committed violations fail the job instead of being rewritten only in CI.

Any PR that introduces a banned raw query method under `apps/core-api/src` will fail that backend job. Seed, test, and script files may remain exempt from `no-restricted-syntax`; application code in `src/` must stay banned.

To run locally (same command as CI):

```bash
npm --prefix apps/core-api run lint
```
