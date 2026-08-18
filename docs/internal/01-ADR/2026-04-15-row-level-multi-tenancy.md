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
  - firebase
  - user-management
---

# ADR-0013: Row-Level Multi-Tenancy

## Status

**Accepted** — 2026-04-15

**Amended** — 2026-04-22 (Hybrid Authentication & Membership Foundation)

**Amended** — 2026-08-18 (AUT-154: single-tenant restore not productized; explicit deferral)

## Context

Auto Core Platform is currently a **single-tenant application**: one running Cloud Run instance and one PostgreSQL database serve a single workshop customer. As we prepare to onboard additional workshop customers, we must decide on a multi-tenancy strategy.

Our core constraints are:

1. **Deployment velocity.** Spinning up a dedicated Cloud Run service and PostgreSQL instance for each new customer is operationally expensive, slow, and error-prone. We maintain a single deployment pipeline and cannot afford a branching-per-customer model.
2. **Cost-efficiency.** Each new dedicated PostgreSQL instance adds a fixed monthly floor cost regardless of utilisation. At launch scale, most customer databases would be nearly idle. Google Cloud Run's shared-compute model is already proven to serve our workload cost-effectively.
3. **DRY codebase.** Schema, business logic, API layer, and frontend must remain unified. Per-customer forks violate every principle of sustainable product development.
4. **Strict data isolation.** Despite sharing infrastructure, a mechanic logged into Workshop A must have **zero ability** to read, write, or infer the existence of Workshop B's data — even in the event of a developer error. Data isolation must be enforced at the ORM layer, not left to per-query discipline.

As the platform moves from script-based onboarding toward real SaaS administration, a second problem has become unavoidable: **Firebase Custom Claims alone cannot act as the system of record for user membership**. They are excellent for stateless request-time authorization, but they are poor at powering relational product features such as a tenant user directory, invite flows, team management DataTables, and cross-tenant platform administration. We therefore need a persistent relational membership layer in PostgreSQL without sacrificing the performance and simplicity of JWT-based request authorization.

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

#### 2. Authentication & Membership: Hybrid Auth Architecture

The original JWT-based request model remains intact, but **Firebase Custom Claims are no longer treated as the system of record for user membership**. Instead, we adopt a hybrid model:

- **PostgreSQL is the source of truth** for users and tenant memberships.
- **Firebase remains the authentication provider and token transport layer**.
- **JWT bearer tokens still carry `tenantId` and `role`** for fast, stateless request processing.
- **Existing request middleware remains unchanged** because the database state is synchronized into Firebase Custom Claims.

**New relational models:**

```prisma
model User {
  id          String         @id @default(uuid())
  firebaseUid String         @unique
  email       String         @unique
  firstName   String?
  lastName    String?
  memberships TenantMember[]
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  @@map("users")
}

enum TenantMemberRole {
  OWNER
  ADMIN
  TECH
  SALES
}

model TenantMember {
  id        String           @id @default(uuid())
  tenant_id String
  tenant    Tenant           @relation(fields: [tenant_id], references: [id])
  user_id   String
  user      User             @relation(fields: [user_id], references: [id])
  role      TenantMemberRole
  is_active Boolean          @default(true)
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  @@index([tenant_id])
  @@index([user_id])
  @@unique([tenant_id, user_id])
  @@map("tenant_members")
}
```

A single `User` may hold memberships in multiple tenants in PostgreSQL. However, the JWT still represents **one active tenant context per session**. The `tenantId` and `role` claims embedded in the bearer token are therefore treated as a synchronized projection of the user's currently active `TenantMember`, not the source of truth.

**JWT payload remains hot-path optimized:**

```json
{
  "sub": "firebase-uid-9f3c2b7a",
  "email": "ali@thunder-auto.com",
  "tenantId": "550e8400-e29b-41d4-a716-446655440000",
  "role": "ADMIN",
  "iat": 1744000000,
  "exp": 1744086400
}
```

In the current backend, `sub` maps to Firebase `decoded.uid` rather than the relational `User.id`. `tenantId` remains the PostgreSQL tenant UUID carried in the custom claims payload.

The `tenantId` claim is still extracted and validated by `JwtAuthGuard` on every authenticated request. It is **never sourced from the request body or query parameters** — only from the signed JWT payload, preventing tenant spoofing.

**Synchronization workflow:**

1. Backend writes `User` and `TenantMember` state to PostgreSQL.
2. Backend immediately calls the Firebase Admin SDK to update the user's custom claims, e.g. `{ tenantId: "xyz", role: "ADMIN" }`.
3. For security-sensitive membership changes such as role downgrades, tenant removal, or membership deactivation, the backend also revokes the user's Firebase refresh tokens after the claim sync succeeds. This does not invalidate an already-issued ID token by itself, but it prevents missed-socket or offline clients from minting fresh privileged tokens later.
4. Backend emits `auth:claims_updated` to the affected user's private Socket.io room (for example `user_<firebaseUid>`), not to the whole tenant room.
5. The React 19 frontend listens for `auth:claims_updated` and silently forces a Firebase token refresh via `currentUser.getIdToken(true)`.
6. After the forced refresh, the frontend updates the global auth context and invalidates TanStack Query caches so role-sensitive screens re-resolve immediately.
7. If the forced refresh fails or the refreshed token no longer carries an active `tenantId` / `role` pair, the frontend clears auth state and signs the user out of privileged screens.
8. Existing `auth.service.ts` logic continues to trust the token claims for request-time authorization without an extra membership database lookup.

This real-time claims refresh path is mandatory for role downgrades, membership deactivation, tenant removal, and any other `TenantMember` mutation that changes effective access. Refresh-token revocation is a complementary control for sensitive changes, not a substitute for the targeted socket refresh path.

**Administrative modules introduced by this decision:**

- `PlatformAdminModule` for internal `Tenant` CRUD, protected by a `SuperAdminGuard` backed by a platform-level claim. If a short-lived bootstrap fallback is ever required before that claim exists, it must use an environment-configured admin-email allowlist with a documented expiration date and removal criterion before release; hardcoded identities are forbidden.
- Bootstrapping the first platform administrator, or creating a persistent platform-admin record outside the normal authenticated admin flow, must happen through a dedicated deployment-scoped Prisma seed / CLI script that runs with direct production environment access and uses Firebase Admin plus Prisma directly. This capability must not be exposed as an HTTP endpoint.
- `TenantMemberModule` for invite, list, update, and deactivate membership workflows.
- `POST /tenant-members/invite` resolves or provisions the Firebase user, writes the `User`, writes the `TenantMember`, and synchronizes custom claims.
- `PATCH /tenant-members/:id` (or equivalent role / activation endpoint) must synchronize claims, revoke Firebase refresh tokens for security-sensitive changes, and emit `auth:claims_updated` to the affected user's private socket room immediately after the membership mutation succeeds.
- Frontend admin routes:
  - `/platform/tenants` for Super Admin tenant management.
  - `/settings/team` for tenant-scoped team management.

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
| **ADR-0001** — Prisma `$extends` Real-Time Sync | The tenant isolation extension is chained before the real-time extension. **WebSocket event scoping is resolved via Socket.io Rooms.** On authenticated socket connection the gateway executes both `client.join('tenant_' + jwt.tenantId)` for tenant-scoped entity events and `client.join('user_' + jwt.sub)` (or equivalent Firebase UID room) for private auth refresh events. The `createDashboardRealtimeExtension` reads `tenantId` from the ALS context (already populated by `TenantMiddleware`) and emits to the room: `this.server.to('tenant_' + tenantId).emit('entityUpdated', payload)` instead of the current global `this.server.emit(...)`. Separately, membership-changing application services emit `auth:claims_updated` only to the affected user room so the frontend can force `getIdToken(true)`, refresh auth state, and invalidate TanStack Query caches without broadcasting auth churn tenant-wide. Real-time events in the WebSocket payload do not carry `tenant_id` — tenancy is enforced by room membership at the socket layer. |
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
- **Relational user management becomes possible.** `User` and `TenantMember` allow efficient DataTable-backed features such as team directories, invite flows, and tenant membership administration.
- **Request-time auth remains fast.** Existing middleware continues to read `tenantId` and `role` from the JWT without an additional database lookup on every request.
- **Connected sessions self-heal after access changes.** Targeted `auth:claims_updated` events force token refresh, auth-context reconciliation, and query invalidation without requiring a full reload.
- **Platform administration becomes tractable.** Super Admin workflows such as tenant CRUD and subscription-facing management now have a relational foundation.

### Negative

- **Massive upfront schema migration.** Every domain table requires a `tenant_id` column and a foreign key to `Tenant`. All existing unique indexes must be dropped and recreated as composite unique indexes. For a production system with data, this migration must be carefully orchestrated with backward-compatible steps (add nullable → backfill → add NOT NULL constraint).
- **Composite unique constraint discipline.** Developers adding new entities or new uniqueness constraints **must** always include `tenant_id` as the first key in any `@@unique` or `@@index` that conceptually scopes to a tenant. A missing `tenant_id` in a unique constraint is a silent multi-tenant correctness bug, not a compile-time error.
- **Raw query prohibition.** Any RLS bypass (e.g., cross-tenant admin reporting) requires out-of-band tooling (e.g., a privileged internal service with a non-extended Prisma client) that is not covered by this ADR and must undergo separate architectural review before use.
- **WebSocket tenant isolation — resolved via Socket.io Rooms.** On socket connection, the NestJS gateway calls `client.join('tenant_' + jwt.tenantId)`. The `createDashboardRealtimeExtension` is updated to emit `this.server.to('tenant_' + tenantId).emit(...)` instead of broadcasting globally. `tenantId` is sourced from the ALS context, which is already populated by `TenantMiddleware` for the duration of the originating HTTP request that triggered the mutation. No changes are required to event payloads.
- **Testing complexity.** Integration tests must seed a `Tenant` row and establish an ALS context before any Prisma operation. Test helpers must be updated to inject a default `tenantId`.
- **Dual-write synchronization complexity.** Membership changes now touch both PostgreSQL and Firebase Custom Claims. Failure handling, retries, token refresh semantics, and selective refresh-token revocation for security-sensitive changes must be defined carefully.
- **Token staleness is reduced, not eliminated.** Connected sessions can be forced to refresh through `auth:claims_updated`, but disconnected clients still depend on the normal token refresh or expiry cycle. Forced-refresh failure is therefore a first-class sign-out and access-loss path, not an exceptional edge case.
- **User lifecycle becomes broader than authentication.** Placeholder invitees, deactivated memberships, and cross-tenant membership history now require explicit domain handling instead of being delegated entirely to Firebase.
- **Single-tenant restore is not productized (AUT-154).** Shared-schema PITR is all-or-nothing: a Neon point-in-time restore rewinds every tenant. Draft files under `tools/tenant-restore/` are not a supported restore path (stale hardcoded purge list, table-owner RLS bypass, no Neon drill). PostgreSQL list-partitioning of hot tables is also **not rolled out** — do not assume `DROP PARTITION` restore or tenant offboarding exists. Current status: [single-tenant restore playbook](../05-Runbooks/single-tenant-restore-playbook.md) (banner: not productized) and [deferral with tenant-count / data-size triggers](../.architecture/deferrals.md#single-tenant-restore-tooling). Partitioning draft: [postgres-tenant-partitioning-rollout.md](../05-Runbooks/postgres-tenant-partitioning-rollout.md).

### Neutral

- The authentication change from API key to JWT is a prerequisite, not a consequence. Existing consumers must rotate credentials at cutover.
- The `Tenant` table is not a "domain entity" in the business sense — it is infrastructure. It does not participate in the real-time entity map (ADR-0001) and is explicitly excluded from `SUPPORTED_ENTITY_TYPES`.
- Per-tenant `FinanceSettings` means the initial data seeding step at tenant onboarding must create a `FinanceSettings` row. Onboarding runbooks must be updated accordingly.
- A JWT still carries only one active tenant context per session. Supporting a tenant switcher or simultaneous multi-tenant sessions is a future product decision, not part of this amendment.
- Until two or more production tenants hold live customer data, full-branch Neon PITR is an acceptable disaster-recovery stand-in for single-tenant restore. That equivalence ends when the [deferral triggers](../.architecture/deferrals.md#single-tenant-restore-tooling) fire.

---

## Follow-On Feature: Tenant Management & User Membership Foundation

### Objective

Introduce the relational and administrative foundation required to manage tenants and tenant members as first-class SaaS concepts while preserving the current fast JWT-based request pipeline, collapsing stale-token windows for connected clients, and keeping admin UX inside the platform's established page and sheet patterns.

### Execution Steps

1. **Database Schema Update (Prisma)**
  - Create a `User` model with `id`, `firebaseUid`, `email`, `firstName`, `lastName`, and standard timestamps.
  - Create a `TenantMember` model with `id`, `tenant_id`, `user_id`, `role`, `is_active`, and standard timestamps.
  - Add `@@unique([tenant_id, user_id])` on `TenantMember`.

2. **Backend API Development (NestJS)**
  - Create `PlatformAdminModule` with internal `Tenant` CRUD endpoints.
  - Protect tenant CRUD routes with `SuperAdminGuard` using a system-level claim. If a bootstrap fallback is needed temporarily, it must use an environment-configured allowlist of platform-admin emails with an explicit expiration date and removal criterion.
  - The initial platform-admin bootstrap path must bypass HTTP entirely. Provide a dedicated Prisma seed / CLI command (for example `npm --prefix apps/core-api run db:seed:platform-admin -- --email=founder@autocore.com`) that is run only from a trusted deployment or operations context with direct database credentials.
  - The seed / CLI bootstrap writes any persistent platform-admin record required by the design, uses Prisma directly, calls Firebase Admin to synchronize the corresponding claims, and is never invokable by an end-user request.
  - Create `TenantMemberModule` with `POST /tenant-members/invite` and supporting list/update endpoints.
  - `TenantMember` mutations (invite, role change, deactivate, reactivate, tenant reassignment) must trigger the same side effect chain in order: persist PostgreSQL state, synchronize Firebase Custom Claims, revoke Firebase refresh tokens when the change is security-sensitive, then emit `auth:claims_updated` to the affected user's private socket room.
  - Invite workflow:
    - Check whether the user exists by email.
    - If not, provision the Firebase identity required to obtain a `firebaseUid`, create the `User` row, and trigger a Firebase invite/reset-link flow.
    - Create the `TenantMember` record.
    - Immediately synchronize Firebase Custom Claims to reflect the user's active `tenantId` and `role`.
  - List endpoints must be written to avoid N+1 queries by default:
    - Tenant member queries load related users in one read, e.g. `prisma.tenantMember.findMany({ include: { user: true } })`.
    - Tenant listing endpoints use relation counts / aggregate queries for member totals instead of looping over tenants and issuing per-row count queries.
  - Bulk invite workflows must avoid serial `await` loops:
    - Build Firebase Admin SDK calls as an array of promises and resolve them concurrently as one batch.
    - Persist the corresponding `User` / `TenantMember` rows with `createMany` or concurrent Prisma writes inside a transaction.

3. **Frontend UI Implementation (React 19 / Vite)**
  - Add `/platform/tenants` for Super Admins.
  - Use the shared `DataTable` for tenant listing with in-table `Skeleton` loaders for loading states and an inline error state with retry inside the table shell.
  - Place `+ Tenant` in the top-right header area.
  - Clicking `+ Tenant` opens a shadcn `Dialog` or `Sheet`; no full-page create route is allowed.
  - Clicking an existing tenant row opens a detail `Sheet` for editing; no full-page edit route is allowed.
  - Tenant queries use strict TanStack Query v5 key factories only; inline array keys are forbidden.
  - Add `/settings/team` for tenant admins.
  - Use the shared `DataTable` for `TenantMember` listing with in-table `Skeleton` loaders for loading states and an inline error state with retry inside the table shell.
  - Place `+ Member` in the top-right header area.
  - Clicking `+ Member` opens a shadcn `Dialog` or `Sheet`; no full-page invite route is allowed.
  - Clicking an existing team row opens a detail `Sheet`.
  - Role changes in the team detail sheet use the shared `InlineEdit` field-level save-on-blur pattern and call a `PATCH` membership endpoint that immediately triggers the claims refresh sequence above.
  - The frontend auth layer listens for `auth:claims_updated`, forces `currentUser.getIdToken(true)`, refreshes the global auth context, and invalidates TanStack Query caches.
  - If the refreshed token no longer authorizes the current route, the UI signs the user out and exits the privileged screen gracefully instead of leaving stale data visible.
  - Use TanStack Query v5 with strict query key factories, e.g. `tenantMemberKeys.list({ tenantId })`; inline array keys are forbidden.

### Acceptance Criteria

Reviewed against the 2026-08-18 codebase. Each item is **done**, **partial**, or **open**.

- [x] Prisma migrations run successfully without data loss. **Done** — `Tenant`, `User`, `TenantMember`, `PlatformAdmin`, and `tenant_id` on domain tables exist in the Prisma schema and applied migrations.
- [x] NestJS successfully synchronizes a membership change in PostgreSQL to Firebase Custom Claims. **Done** — `TenantMemberService.syncUserClaims()` writes Firebase custom claims after invite and update.
- [x] Initial platform-admin bootstrap is performed only through a deployment-scoped Prisma seed / CLI path, not through a public HTTP endpoint. **Done** — `npm --prefix apps/core-api run db:seed:platform-admin` runs `scripts/seed-platform-admin.ts`. Tenant CRUD HTTP routes do not create `PlatformAdmin` rows.
- [x] Security-sensitive membership changes revoke Firebase refresh tokens after claims are synchronized. **Done** — role changes and deactivation call `revokeRefreshTokens` after claim sync.
- [x] `TenantMember` role / activation changes emit `auth:claims_updated` to the affected user's private socket room. **Done** — `DashboardRealtimeService.emitClaimsUpdated()` emits to `user_<firebaseUid>`.
- [x] A connected frontend session silently forces a token refresh, updates the auth context, and invalidates TanStack Query caches when `auth:claims_updated` is received. **Done** — `RealtimeDashboardSyncProvider` calls `getIdToken(true)`, invalidates queries (including the auth session), and signs out if refresh fails.
- [x] Existing `auth.service.ts` request middleware continues to function without modification by reading the synchronized claims. **Done** — request-time tenant auth still reads `tenantId` / `role` from the JWT. Platform-admin access additionally consults an active `PlatformAdmin` row (later hardening; JWT claims are not the platform-admin source of truth).
- [x] Frontend query usage follows TanStack Query v5 key-factory discipline; no inline array query keys are introduced. **Done** — tenant and platform-tenant modules use `tenantMemberKeys` / `platformTenantKeys`. (Unrelated modules still have some inline keys; out of scope for this ADR.)
- [x] Primary list pages use the standardized shared `DataTable` component. **Done** — `/platform/tenants` and Settings → Team (`/settings?tab=team`) both use `DataTable`. Team shipped as a Settings tab rather than a dedicated `/settings/team` route.
- [x] Page action buttons remain exclusively in the top-right header area. **Done** — `+ Tenant` and `+ Member` sit in the top-right of their respective headers; create/edit use Dialog/Sheet, not full-page routes.
- [x] Team role edits use the shared `InlineEdit` save-on-blur pattern rather than a full-page edit flow. **Done** — role is `InlineEdit` in the member detail Sheet.
- [x] Database access uses bulk-fetch / pre-fetch-and-map patterns; no `await` calls inside loops when resolving tenant member data. **Done** — list queries `include: { user: true }`. There is no bulk-invite API yet; single-member invite is sequential by design.
- [x] N+1 query prevention is verified on the backend by using `include: { user: true }` for tenant members and aggregate / relation-count queries for tenant summaries. **Done** — tenant list uses `_count.memberships`.
- [ ] DataTable-driven admin screens render loading states with `Skeleton` rows and keep error states inside the table shell with an inline retry path. **Partial** — `DataTable` shows a "Loading..." cell, not `Skeleton` rows. Team and tenant list errors render a retry banner *above* the table, not inside the table shell.

---

## Alternatives Considered

| Option | Description | Pros | Cons | Verdict |
|--------|-------------|------|------|---------|
| **A — Database-per-tenant** | Each customer gets a dedicated PostgreSQL instance. Application routes to the correct DB by tenant subdomain at connection time. | Strongest possible isolation. Easy per-tenant backup and restore. Schema migrations can be staggered per customer. | $50–$150+/month per customer at minimum regardless of activity. Requires a connection-routing layer. Prisma does not natively support dynamic database URLs per request. Operational burden grows linearly with customer count. | **Rejected** |
| **B — Schema-per-tenant** | All tenants share a single PostgreSQL server. Each tenant gets its own PostgreSQL schema (`thunder_auto.*`, `city_motors.*`). Prisma sets `search_path` per request. | Strong isolation (PostgreSQL enforces schema separation at the engine level). Easier per-tenant migrations. Backup per schema is possible. | Prisma Migrate does not support dynamic schema targeting — migrations run against a single, hard-coded schema. Workarounds (running migrations programmatically per schema) introduce operational fragility. At 50+ tenants, the number of live schemas creates non-trivial PostgreSQL catalog overhead. The real-time extension (ADR-0001) and connection pooling (PgBouncer / Cloud SQL) interact poorly with per-request `search_path` switching. | **Rejected** |
| **C — Row-Level Multi-Tenancy (Shared Schema)** | All tenants share tables. Every row is tagged with `tenant_id`. ORM layer enforces scoping via Prisma `$extends` + NestJS ALS. | Zero infrastructure overhead for new tenants. No Prisma Migrate limitations. Works seamlessly with existing Cloud Run + Cloud SQL setup. Defence-in-depth isolation enforced at ORM layer. | Requires schema migration across all tables. Composite unique constraints must be maintained as a convention. Raw queries bypass isolation. | **Accepted** |

### Authentication & Membership Alternatives Considered

| Option | Description | Pros | Cons | Verdict |
|--------|-------------|------|------|---------|
| **D — Claims-Only Membership** | Store tenant assignment and role exclusively in Firebase Custom Claims, with no relational membership tables in PostgreSQL. | Fast request-time auth. Minimal schema work. | Cannot support user directory queries, invite workflows, tenant team tables, or cross-tenant administration without abusing Firebase as an application database. No reliable system of record for memberships. | **Rejected** |
| **E — Database Lookup on Every Request** | Resolve tenant membership from PostgreSQL for every authenticated request and ignore token claims for authorization. | PostgreSQL is authoritative. No claim synchronization required. | Adds a membership database hit to every request, complicates the hot path, and throws away the performance benefits of stateless JWT authorization already established in this ADR. | **Rejected** |
| **F — Hybrid Auth & Membership** | Store `User` and `TenantMember` in PostgreSQL, then synchronize active membership into Firebase Custom Claims so JWTs still carry `tenantId` and `role`. | Preserves fast stateless auth while enabling relational admin features and DataTable-backed user management. | Introduces claim synchronization and token-refresh complexity. | **Accepted as Amendment** |

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
- `05-Runbooks/single-tenant-restore-playbook.md` — single-tenant restore is **not productized** (AUT-154); see `.architecture/deferrals.md`
- `05-Runbooks/postgres-tenant-partitioning-rollout.md` — list-partitioning of hot tables is **not rolled out**

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Multi-Tenant Architecture (ADR-0013)](https://linear.app/auto-core-platform/project/multi-tenant-architecture-adr-0013-e71df25419b2) |
| Milestone 1 | Phase 1 — Foundation (target: 2026-04-30) |
| Milestone 2 | Phase 2 — ORM Isolation Layer (target: 2026-05-15) |
| Milestone 3 | Phase 3 — WebSocket Tenant Scoping (target: 2026-05-22) |
| Milestone 4 | Phase 4 — Testing and Contract (target: 2026-05-31) |
| Issues | AUT-59, AUT-60, AUT-61, AUT-62, AUT-63, AUT-64, AUT-65, AUT-66, AUT-67, AUT-68, AUT-69, AUT-70, AUT-71, AUT-72, AUT-73, AUT-74, AUT-154 |

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
| [AUT-71](https://linear.app/auto-core-platform/issue/AUT-71) | DB-4: Build Prisma schema linter for tenant isolation in CI | Phase 1 | Urgent |
| [AUT-72](https://linear.app/auto-core-platform/issue/AUT-72) | OPS-1: Develop Single-Tenant Restore Runbook | Phase 4 | High |
| [AUT-154](https://linear.app/auto-core-platform/issue/AUT-154) | OPS-2: Implement or explicitly defer single-tenant restore tooling | Maintenance P2 | Medium |
| [AUT-73](https://linear.app/auto-core-platform/issue/AUT-73) | OPS-2: Connection Pooling Strategy & Metrics | Phase 4 | High |
| [AUT-74](https://linear.app/auto-core-platform/issue/AUT-74) | DB-5: PostgreSQL Declarative Partitioning | Phase 4 | Low |
