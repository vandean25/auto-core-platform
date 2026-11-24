# Systems Architect Review: Row-Level Multi-Tenancy (ADR-0013)

**Reviewer**: Systems Architect
**Target**: ADR-0013: Row-Level Multi-Tenancy (Shared Schema)
**Date**: 2026-04-18
**Review Type**: Specialist Review

---

## Specialist Perspective

**Focus**: Overall system coherence, scalability patterns, distributed systems, and technical governance.

I focus on how components work together as a cohesive system. For multi-tenancy, I evaluate the long-term viability of the shared architecture, blast radius of outages, scalability ceilings, noisy neighbor problems, and operational realities (like disaster recovery) that emerge from tight coupling of tenant data.

---

## Executive Summary

The decision to use row-level multi-tenancy via Prisma `$extends` and NestJS AsyncLocalStorage is highly pragmatic for the current scale and perfectly aligns with the cost-efficiency goals of Cloud Run. However, this tight coupling aggregates systemic risk into a single database instance and makes single-tenant data recovery extremely difficult. While the ORM isolation is robust, the current architecture lacks proactive measures for tenant-level resource isolation and disaster recovery methodologies.

**Overall Assessment**: Good

**Key Findings**:
- **Strong Application-Level Isolation**: The Prisma extension approach provides robust defense-in-depth data isolation without burdening product developers.
- **Noisy Neighbor Vulnerability**: Sharing a single database without resource quotas makes all tenants susceptible to performance degradation caused by a single heavy user.
- **Disaster Recovery Gap**: Row-level tenancy makes Point-In-Time Recovery (PITR) for a single tenant nearly impossible without complex, custom logical extraction scripts.

**Critical Actions Required**: 3

---

## Current Implementation

The ADR details a shared-schema, row-level multi-tenant architecture. 

**Scope Reviewed**:
- Data Isolation mechanism (Prisma extension + ALS)
- Schema invariants (`tenant_id` propagation)
- Interaction with existing ADRs (Real-time sync, Fiscal locking)
- Consequences and Alternatives Considered

**Key Components**:
- `prisma-tenant-isolation.extension.ts`: Intercepts `$allOperations` to inject `tenant_id`.
- `schema.prisma`: Adds `tenant_id` and composite unique constraints to all domain entities.
- `tenant-context.service.ts`: Propagates tenant context using AsyncLocalStorage.

**Pattern/Approach Used**: Database row-level multi-tenancy utilizing ORM middleware for implicit scoping, backed by JWT-extracted dimensions.

---

## Assessment

### Strengths

1. **Operational Simplicity & Cost-Efficiency**: Utilizing a single PostgreSQL instance and a unified CI/CD pipeline keeps operational overhead and infrastructure costs minimal. This is the optimal choice for a growing startup seeking to onboard users rapidly.
2. **Developer Experience**: By moving the isolation mechanism to the ORM/Middleware layer (via Prisma `$allOperations` & NestJS ALS), standard application code remains largely unmodified and ignorant of tenancy. This lowers cognitive load.
3. **Architectural Coherence**: Modifying the WebSocket architecture to use Socket.io Rooms based on `tenantId` aligns perfectly with the HTTP isolation strategy. 

### Concerns

1. **Single-Tenant Disaster Recovery** (Severity: Critical)
   - **Issue**: Standard RDS/Cloud SQL automated backups restore the *entire* database. If a single workshop accidentally deletes critical data, we cannot use standard PITR to restore them without overwriting other tenants' data.
   - **Location**: System Operational Architecture
   - **Impact**: High risk of data loss or extreme manual operational pain during a tenant-specific data incident.
   - **Fix**: Design and document a logical backup/restore strategy (e.g., `pg_dump` with `--enable-row-security` or custom scripts) tailored for tenant-specific extraction.
   - **Effort**: Large

2. **Noisy Neighbor / Resource Starvation** (Severity: High)
   - **Issue**: A heavy analytical query, large export, or bulk import from Tenant A will consume CPU/IO IOPS on the shared PostgreSQL instance, causing high latency for Tenant B. 
   - **Location**: Shared PostgreSQL Instance
   - **Impact**: Unpredictable performance and potential SLA breaches.
   - **Fix**: Implement application-level rate limiting per-tenant, and consider configuring PostgreSQL `statement_timeout` for standard web requests.
   - **Effort**: Medium

3. **Composite Unique Index Fragility** (Severity: High)
   - **Issue**: The ADR relies on conventional discipline ("Developers adding new entities... must always include tenant_id as the first key"). Human discipline fails at scale. A missing `tenant_id` in a unique constraint is a silent, catastrophic multi-tenant bug.
   - **Location**: `schema.prisma` practices
   - **Impact**: Fatal cross-tenant data collisions or runtime errors constraints blocking inserts for other tenants.
   - **Fix**: Create a custom linter or AST parser for Prisma schema that strictly enforces `tenant_id` as part of every `@@unique` or `@unique` directive.
   - **Effort**: Medium

### Observations

- **Connection Pool Exhaustion**: Cloud Run scales out based on HTTP concurrency. A sudden spike across many tenants might cause Cloud Run to spawn instances, leading to DB connection pool exhaustion. A PgBouncer/Cloud SQL Auth proxy layer will be critical.
- **Future Partitioning**: The addition of `tenant_id` on every table perfectly positions the database for PostgreSQL declarative partitioning by list (`tenant_id`) when the database grows beyond a manageable size.

---

## Recommendations

### Immediate (0-2 Weeks)

1. **Enforce Schema Governance Tooling**
   - **What**: Build a Prisma schema linter running in CI.
   - **Why**: To prevent silent multi-tenant constraint bugs. Missing `tenant_id` in a unique constraint will break the system.
   - **How**: Write a small script using `@prisma/internals` or regex to verify that any model with `tenant_id` includes it in all `@@unique` blocks.
   - **Effort**: Medium
   - **Priority**: Critical

### Short-term (2-8 Weeks)

1. **Develop Single-Tenant Restore Playbook**
   - **What**: Create an operational runbook and tooling to restore a single tenant's data.
   - **Why**: Cloud SQL PITR is all-or-nothing. We need a way to rescue a single customer without rolling back the entire platform.
   - **How**: Develop a script to pull data logically per `tenant_id` from a snapshot clone and selectively upsert it back to primary.
   - **Effort**: Large
   - **Priority**: High

2. **Connection Pooling Strategy & Metrics**
   - **What**: Configure PgBouncer / Connection limits.
   - **Why**: Prevent DB starvation during Cloud Run scale-outs.
   - **How**: Ensure Prisma is using Data Proxy or appropriate connection pooling string, and set up monitoring for pool saturation.
   - **Effort**: Small
   - **Priority**: High

### Long-term (2-6 Months)

1. **PostgreSQL Declarative Partitioning**
   - **What**: Partition the largest tables (e.g., `InventoryTransaction`, `InvoiceItem`) by `tenant_id`.
   - **Why**: Allows independent vacuuming, easier tenant offboarding (drop partition), and caps index traversal times.
   - **How**: Migrate standard tables to partitioned tables in Postgres.
   - **Effort**: Large
   - **Priority**: Nice-to-Have

---

## Best Practices

1. **Logical Sharding as a Stepping Stone**: Applying `tenant_id` strictly on every table sets us up for horizontal sharding (e.g., using Citus) in the future. The application is completely isolated, meaning the DB layer can be distributed later without changing the API contract.
2. **Tenant Metadata Segregation**: Keep the `Tenant` catalog lightweight and heavily cached; avoid putting volatile configuration directly on the `Tenant` table if it forces frequent cache invalidations.

**Industry Standards**:
- **SaaS Multi-Tenancy Patterns**: AWS SaaS Factory recommends exactly this pattern (Pool model) for cost-efficiency, but explicitly warns about the "noisy neighbor" and single-tenant restore challenges.
- **Defense in Depth**: Utilizing ORM middleware (Prisma `$allOperations`) is an industry-standard best practice to guarantee row-level security applies universally at the application level.

---

## Risks

**If Recommendations Not Addressed**:

1. **Catastrophic Cross-Tenant Constraint Collisions** (Likelihood: High, Impact: High)
   - **Description**: A developer adds a new feature with `@unique("slug")` instead of `@@unique([tenant_id, slug])`. Tenant B tries to use a slug already claimed by Tenant A. System throws 500s.
   - **Timeframe**: Anytime during routine feature development.
   - **Mitigation**: Implement the automated Prisma schema linter immediately.

2. **Unrecoverable Single-Tenant Data Loss** (Likelihood: Low, Impact: High)
   - **Description**: A customer accidentally deletes half their workshop orders via API. We have no way to restore just their data from yesterday's backup without wiping out today's sales for all other customers.
   - **Timeframe**: Day 1 of production.
   - **Mitigation**: Develop logical export/import runbooks for single-tenant extraction.
