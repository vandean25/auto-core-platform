---
title: "ADR-0013: Row-Level Multi-Tenancy"
date: "2026-04-15"
status: accepted
deciders: "Lead Cloud Architect, Product Owner, Engineering Team"
linear-project: ""
linear-milestone: ""
tags:
  - adr
  - multi-tenancy
  - security
  - prisma
  - auth
  - database
---

# ADR-0013: Row-Level Multi-Tenancy

## Status

**Accepted** — 2026-04-15

## Context

Auto Core Platform is currently a **single-tenant application**: one running Cloud Run instance and one PostgreSQL database serve a single workshop customer. As we prepare to onboard additional workshop customers, we must decide on a multi-tenancy strategy.

Our core constraints are:

1. **Deployment velocity.** Spinning up a dedicated Cloud Run service and PostgreSQL instance for each new customer is operationally expensive, slow, and error-prone. We maintain a single deployment pipeline and cannot afford a branching-per-customer model.
2. **Cost-efficiency.** Each new dedicated PostgreSQL instance adds a fixed monthly floor cost regardless of utilisation. At launch scale, most customer databases would be nearly idle. Google Cloud Run's shared-compute model is already proven to serve our workload cost-effectively.
3. **DRY codebase.** Schema, business logic, API layer, and frontend must remain unified. Per-customer forks violate every principle of sustainable product development.
4. **Strict data isolation.** Despite sharing infrastructure, a mechanic logged into Workshop A must have **zero ability** to read, write, or infer the existence of Workshop B's data — even in the event of a developer error. Data isolation must be enforced at the ORM layer, not left to per-query discipline.

The decision determines the architectural foundation for all future domain work: every table, every query, every unique constraint, and every authentication flow is affected.

---

## Decision

We will implement **Row-Level Multi-Tenancy in a shared schema** (Option C below).

### Core Mechanism

#### 1. Schema: Universal `tenant_id` Column

A non-nullable, indexed `tenant_id` column is added to **every domain entity table**. This column references a new `Tenant` table that is seeded at onboarding time.

**New `Tenant` table:**

```prisma
model Tenant {
  id         String   @id @default(cuid())
  name       String
  slug       String   @unique        // URL-safe identifier, e.g. "thunder-auto"
  plan       TenantPlan @default(STANDARD)
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  is_active  Boolean  @default(true)
}

enum TenantPlan {
  STANDARD
  PREMIUM
  ENTERPRISE
}
```

Every domain model gains a relation:

```prisma
model SalesOrder {
  id         String   @id @default(cuid())
  tenant_id  String
  tenant     Tenant   @relation(fields: [tenant_id], references: [id])
  // ...existing fields...

  @@index([tenant_id])
}
```

**All existing unique constraints are promoted to composite unique constraints.** For example:

```prisma
// Before (single-tenant)
@@unique([order_number])

// After (multi-tenant)
@@unique([tenant_id, order_number])
```

This applies to every uniqueness invariant across the schema, including (but not limited to) `order_number`, `invoice_number`, `sku`, and `slug` fields.

#### 2. Authentication: JWT with Embedded `tenantId`

The current global API-key authentication is replaced by JWT-based authentication. JWTs are issued by the Auth module upon successful login and contain the following claims:

```json
{
  "sub": "user-cuid",
  "email": "ali@thunder-auto.com",
  "tenantId": "tenant-cuid",
  "role": "ADMIN",
  "iat": 1744000000,
  "exp": 1744086400
}
```

The `tenantId` claim is extracted and validated by a NestJS `JwtAuthGuard` on every authenticated request. It is **never sourced from the request body or query parameters** — only from the signed JWT payload, preventing tenant spoofing.

#### 3. Data Isolation: Prisma Client Extension + AsyncLocalStorage

Data isolation is enforced **automatically at the ORM layer** using a Prisma Client Extension paired with NestJS `AsyncLocalStorage` (ALS). This is the same `$extends` mechanism established in ADR-0001 for real-time sync.

**Tenant Context Propagation (NestJS ALS):**

```typescript
// tenant-context.service.ts
@Injectable()
export class TenantContextService {
  private readonly store = new AsyncLocalStorage<{ tenantId: string }>();

  run<T>(tenantId: string, fn: () => T): T {
    return this.store.run({ tenantId }, fn);
  }

  getTenantId(): string {
    const store = this.store.getStore();
    if (!store?.tenantId) {
      throw new InternalServerErrorException(
        'Tenant context not initialised. Is the TenantMiddleware applied?',
      );
    }
    return store.tenantId;
  }
}
```

A NestJS middleware seeds the ALS context from the verified JWT on every request:

```typescript
// tenant.middleware.ts
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // req.user is populated by JwtAuthGuard before this middleware
    const tenantId = req.user?.tenantId;
    if (!tenantId) return next(); // Unauthenticated routes pass through
    this.tenantContext.run(tenantId, next);
  }
}
```

**Prisma Client Extension (Tenant Isolation):**

The extension uses the `$allOperations` catch-all hook rather than per-operation handlers. This ensures every Prisma query operation — including `count`, `aggregate`, `groupBy`, and `upsert`, which per-operation handlers would silently miss — is intercepted without exception.

> **Security note — `findUnique` / `findUniqueOrThrow` type trap.** Prisma enforces at the type level that the `where` argument of `findUnique` contains only fields that form a `@id`, `@unique`, or `@@unique` index. Injecting `tenant_id` (a plain indexed column) into that `where` object causes a Prisma runtime type error unless `id` and `tenant_id` form a declared composite unique index — which they do not by default. These two operations must therefore be redirected to `findFirst`, which accepts a free-form `where` clause. The `$allOperations` handler detects them by name and returns early after calling the `findFirst` equivalent on the underlying client.

```typescript
// prisma-tenant-isolation.extension.ts
export function createTenantIsolationExtension(
  tenantContext: TenantContextService,
) {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        $allOperations({ operation, args, query }) {
          const tenantId = tenantContext.getTenantId();

          // Standard where-filterable read and write operations.
          // Includes count, aggregate, and groupBy — which per-operation
          // handlers would silently miss, leaking cross-tenant data.
          if (
            [
              'findMany',
              'findFirst',
              'findFirstOrThrow',
              'updateMany',
              'deleteMany',
              'count',
              'aggregate',
              'groupBy',
            ].includes(operation)
          ) {
            args.where = { ...args.where, tenant_id: tenantId };
            return query(args);
          }

          // Targeted single-row mutations; tenant_id is injected into where
          // to prevent a developer from accidentally updating/deleting a row
          // belonging to another tenant if the record id is somehow known.
          if (operation === 'update' || operation === 'delete') {
            args.where = { ...args.where, tenant_id: tenantId };
            return query(args);
          }

          // create: stamp tenant_id onto the new record.
          if (operation === 'create') {
            args.data = { ...args.data, tenant_id: tenantId };
            return query(args);
          }

          // upsert: tenant_id required in both where (lookup) and create
          // (new row). Without it an upsert could match or create rows
          // across tenant boundaries.
          if (operation === 'upsert') {
            args.where = { ...args.where, tenant_id: tenantId };
            args.create = { ...args.create, tenant_id: tenantId };
            return query(args);
          }

          // findUnique / findUniqueOrThrow: Prisma's type system only
          // allows fields that form a declared unique index in these where
          // clauses. Injecting tenant_id (a plain index column) causes a
          // runtime type error. We must NOT call query(args) here; the
          // implementing service must use findFirst instead. Intercepting
          // here with a thrown error surfaces the issue at dev time rather
          // than silently falling through.
          if (
            operation === 'findUnique' ||
            operation === 'findUniqueOrThrow'
          ) {
            throw new Error(
              `[TenantIsolation] Do not use ${operation}() — use findFirst() ` +
              `with an explicit where clause. findUnique bypasses tenant_id ` +
              `injection due to Prisma unique-index type constraints.`,
            );
          }

          return query(args);
        },
      },
    },
  });
}
```

The extension is applied alongside the existing real-time sync extension (ADR-0001):

```typescript
const prismaClient = new PrismaClient()
  .$extends(createTenantIsolationExtension(tenantContextService))
  .$extends(createDashboardRealtimeExtension(dashboardRealtimeService));
```

**Result:** No service-layer code needs to maintain awareness of `tenant_id`. Queries are automatically scoped. A developer cannot accidentally read or write cross-tenant data unless they construct a raw query, which is prohibited.

#### 4. Raw Queries

All `prisma.$queryRaw` and `prisma.$executeRaw` usages are **banned in application code**. They bypass the tenant isolation extension entirely. Any migration requiring raw SQL is executed in a Prisma migration file (not application code) and is scoped to DBA-reviewed, tenant-agnostic DDL operations only.

---

## Interaction with Existing Architectural Invariants

| Existing ADR | Impact |
|---|---|
| **ADR-0001** — Prisma `$extends` Real-Time Sync | The tenant isolation extension is chained before the real-time extension. **WebSocket event scoping is resolved via Socket.io Rooms.** On authenticated socket connection the gateway executes `client.join('tenant_' + jwt.tenantId)`. The `createDashboardRealtimeExtension` reads `tenantId` from the ALS context (already populated by `TenantMiddleware`) and emits to the room: `this.server.to('tenant_' + tenantId).emit('entityUpdated', payload)` instead of the current global `this.server.emit(...)`. Real-time events in the WebSocket payload do not carry `tenant_id` — tenancy is enforced by room membership at the socket layer. |
| **ADR-0002** — Ledger-Based Inventory | `InventoryTransaction` gains `tenant_id`. The ledger pattern (append-only, never direct `InventoryStock` mutation) is unchanged. Ledger reads and writes are automatically scoped by the isolation extension. |
| **ADR-0003** — Fiscal Lock Date | `FinanceSettings` becomes a per-tenant singleton. The lock-date check must be loaded with `findFirst({ where: { tenant_id: ctx } })`. The isolation extension handles this automatically. |
| **ADR-0004** — Invoice Snapshotting | Snapshot fields (`revenue_group_name`, `unit_price`) are tenant-agnostic values stored on immutable `InvoiceItem` rows. No changes required beyond the `tenant_id` column addition. |
| **ADR-0005** — Deletion Policy | Deletion guards are unchanged in logic, but all existence checks now implicitly filter by `tenant_id` via the extension. It is no longer possible to accidentally unblock a deletion by querying across tenants. |
| **ADR-0009** — Sequential Document Numbering | This is the highest-risk interaction. `FinanceSettings` holds the sequential counters for invoice numbers, sales order numbers, and workshop order numbers. This record becomes per-tenant. All `@@unique` single-field constraints on generated numbers become `@@unique([tenant_id, number_field])`. The singleton-guard pattern (increment inside `prisma.$transaction`) continues to apply but is now scoped per tenant. |
| **ADR-0011** — Atomic Status Transition Guards | The `updateMany` guard pattern gains an implicit `tenant_id` filter from the isolation extension. A guard that returns `count === 0` now means either "status was already transitioned" **or** "this entity does not belong to your tenant." Both cases are correctly handled as `ConflictException` (409). |

---

## Consequences

### Positive

- **Zero infrastructure overhead for new customers.** Onboarding a new workshop requires inserting a `Tenant` row and issuing credentials. No Cloud Run deployment, no PostgreSQL provisioning, no DNS setup.
- **Instant scalability.** Cloud Run autoscaling continues to handle traffic spikes across all tenants on shared compute.
- **Single codebase, single deployment pipeline.** All tenants run identical application code. Bug fixes and feature releases are deployed once.
- **Defence-in-depth isolation.** The ALS + Prisma extension chain ensures that forgetting to add `where: { tenant_id }` in a new query is not a security vulnerability — the ORM layer enforces it automatically.
- **Audit trail is tenant-scoped by default.** `InventoryTransaction`, `InvoiceSequence`, and all append-only tables carry `tenant_id`, so per-tenant historical reports are trivially filterable.

### Negative

- **Massive upfront schema migration.** Every domain table requires a `tenant_id` column and a foreign key to `Tenant`. All existing unique indexes must be dropped and recreated as composite unique indexes. For a production system with data, this migration must be carefully orchestrated with backward-compatible steps (add nullable → backfill → add NOT NULL constraint).
- **Composite unique constraint discipline.** Developers adding new entities or new uniqueness constraints **must** always include `tenant_id` as the first key in any `@@unique` or `@@index` that conceptually scopes to a tenant. A missing `tenant_id` in a unique constraint is a silent multi-tenant correctness bug, not a compile-time error.
- **Raw query prohibition.** Any RLS bypass (e.g., cross-tenant admin reporting) requires out-of-band tooling (e.g., a privileged internal service with a non-extended Prisma client) that is not covered by this ADR and must undergo separate architectural review before use.
- **WebSocket tenant isolation — resolved via Socket.io Rooms.** On socket connection, the NestJS gateway calls `client.join('tenant_' + jwt.tenantId)`. The `createDashboardRealtimeExtension` is updated to emit `this.server.to('tenant_' + tenantId).emit(...)` instead of broadcasting globally. `tenantId` is sourced from the ALS context, which is already populated by `TenantMiddleware` for the duration of the originating HTTP request that triggered the mutation. No changes are required to event payloads.
- **Testing complexity.** Integration tests must seed a `Tenant` row and establish an ALS context before any Prisma operation. Test helpers must be updated to inject a default `tenantId`.

### Neutral

- The authentication change from API key to JWT is a prerequisite, not a consequence. Existing consumers must rotate credentials at cutover.
- The `Tenant` table is not a "domain entity" in the business sense — it is infrastructure. It does not participate in the real-time entity map (ADR-0001) and is explicitly excluded from `SUPPORTED_ENTITY_TYPES`.
- Per-tenant `FinanceSettings` means the initial data seeding step at tenant onboarding must create a `FinanceSettings` row. Onboarding runbooks must be updated accordingly.

---

## Alternatives Considered

| Option | Description | Pros | Cons | Verdict |
|--------|-------------|------|------|---------|
| **A — Database-per-tenant** | Each customer gets a dedicated PostgreSQL instance. Application routes to the correct DB by tenant subdomain at connection time. | Strongest possible isolation. Easy per-tenant backup and restore. Schema migrations can be staggered per customer. | $50–$150+/month per customer at minimum regardless of activity. Requires a connection-routing layer. Prisma does not natively support dynamic database URLs per request. Operational burden grows linearly with customer count. | **Rejected** |
| **B — Schema-per-tenant** | All tenants share a single PostgreSQL server. Each tenant gets its own PostgreSQL schema (`thunder_auto.*`, `city_motors.*`). Prisma sets `search_path` per request. | Strong isolation (PostgreSQL enforces schema separation at the engine level). Easier per-tenant migrations. Backup per schema is possible. | Prisma Migrate does not support dynamic schema targeting — migrations run against a single, hard-coded schema. Workarounds (running migrations programmatically per schema) introduce operational fragility. At 50+ tenants, the number of live schemas creates non-trivial PostgreSQL catalog overhead. The real-time extension (ADR-0001) and connection pooling (PgBouncer / Cloud SQL) interact poorly with per-request `search_path` switching. | **Rejected** |
| **C — Row-Level Multi-Tenancy (Shared Schema)** | All tenants share tables. Every row is tagged with `tenant_id`. ORM layer enforces scoping via Prisma `$extends` + NestJS ALS. | Zero infrastructure overhead for new tenants. No Prisma Migrate limitations. Works seamlessly with existing Cloud Run + Cloud SQL setup. Defence-in-depth isolation enforced at ORM layer. | Requires schema migration across all tables. Composite unique constraints must be maintained as a convention. Raw queries bypass isolation. | **Accepted** |

---

## References

- `01-ADR/2026-04-12-prisma-extends-realtime-sync.md` (ADR-0001) — Prisma `$extends` mechanism this ADR extends for tenant isolation
- `01-ADR/2026-04-12-ledger-based-inventory.md` (ADR-0002) — Inventory ledger: `InventoryTransaction.tenant_id` must be added
- `01-ADR/2026-04-12-fiscal-lock-date.md` (ADR-0003) — `FinanceSettings` becomes per-tenant singleton
- `01-ADR/2026-04-12-invoice-snapshotting.md` (ADR-0004) — Invoice snapshots carry `tenant_id` transparently
- `01-ADR/2026-04-12-deletion-policy-enforcement.md` (ADR-0005) — Deletion guards become automatically tenant-scoped
- `01-ADR/2026-04-12-sequential-document-numbering.md` (ADR-0009) — All sequential counters and their uniqueness constraints become per-tenant
- `01-ADR/2026-04-12-openapi-contract-first.md` (ADR-0010) — Auth header changes from API key to `Authorization: Bearer <JWT>`; OpenAPI spec must be regenerated
- `01-ADR/2026-04-12-atomic-status-transition-guards.md` (ADR-0011) — `updateMany` guards gain implicit tenant scoping via isolation extension

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Multi-Tenant Architecture (ADR-0013)](https://linear.app/auto-core-platform/project/multi-tenant-architecture-adr-0013-e71df25419b2) |
| Milestone 1 | Phase 1 — Foundation (target: 2026-04-30) |
| Milestone 2 | Phase 2 — ORM Isolation Layer (target: 2026-05-15) |
| Milestone 3 | Phase 3 — WebSocket Tenant Scoping (target: 2026-05-22) |
| Milestone 4 | Phase 4 — Testing and Contract (target: 2026-05-31) |
| Issues | AUT-59, AUT-60, AUT-61, AUT-62, AUT-63, AUT-64, AUT-65, AUT-66, AUT-67, AUT-68, AUT-69, AUT-70 |

### Issue Breakdown

| Issue | Title | Milestone | Priority |
|-------|-------|-----------|----------|
| [AUT-59](https://linear.app/auto-core-platform/issue/AUT-59) | DB-1: Create Tenant table and TenantPlan enum | Phase 1 | Urgent |
| [AUT-60](https://linear.app/auto-core-platform/issue/AUT-60) | DB-2: Add tenant_id column to all domain entity tables | Phase 1 | Urgent |
| [AUT-61](https://linear.app/auto-core-platform/issue/AUT-61) | DB-3: Promote all unique constraints to composite (tenant_id + field) | Phase 1 | Urgent |
| [AUT-62](https://linear.app/auto-core-platform/issue/AUT-62) | BE-1: Replace API-key auth with JWT (tenantId claim) | Phase 1 | Urgent |
| [AUT-63](https://linear.app/auto-core-platform/issue/AUT-63) | BE-2: Implement TenantContextService with AsyncLocalStorage | Phase 2 | High |
| [AUT-64](https://linear.app/auto-core-platform/issue/AUT-64) | BE-3: Implement createTenantIsolationExtension (Prisma $allOperations) | Phase 2 | Urgent |
| [AUT-65](https://linear.app/auto-core-platform/issue/AUT-65) | BE-4: Enforce raw query prohibition via ESLint and remove existing uses | Phase 2 | High |
| [AUT-66](https://linear.app/auto-core-platform/issue/AUT-66) | BE-5: Update real-time gateway to emit events to tenant Socket.io Rooms | Phase 3 | Urgent |
| [AUT-67](https://linear.app/auto-core-platform/issue/AUT-67) | BE-6: Enforce JWT authentication on WebSocket gateway connections | Phase 3 | Urgent |
| [AUT-68](https://linear.app/auto-core-platform/issue/AUT-68) | QA-1: Update integration test helpers to seed Tenant row and ALS context | Phase 4 | High |
| [AUT-69](https://linear.app/auto-core-platform/issue/AUT-69) | QA-2: Tenant isolation regression tests (cross-tenant data leakage prevention) | Phase 4 | Urgent |
| [AUT-70](https://linear.app/auto-core-platform/issue/AUT-70) | BE-7: Regenerate OpenAPI spec and frontend types after auth scheme change | Phase 4 | High |
