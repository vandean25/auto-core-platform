# Runbook: SystemPrisma Allowlist

**Status:** Active
**Enforced by:** AUT-135 — typed wrapper in `apps/core-api/src/prisma/system-prisma.service.ts`
**ADR:** [ADR-0013: Row-Level Multi-Tenancy](../01-ADR/2026-04-15-row-level-multi-tenancy.md)

---

## Why SystemPrisma Is Narrow

`PrismaService` runs the tenant-isolation extension. `SystemPrismaService` does not — it exists for global identity tables and three jobs that cannot use request tenant context.

Calling it on a tenant model (for example `systemPrisma.customer`) silently bypasses isolation. The public type therefore exposes only allowlisted delegates. TypeScript rejects the rest; interactive `$transaction` clients are wrapped the same way at runtime.

---

## Allowed Delegates

| Delegate | Why |
|---|---|
| `tenant`, `user`, `platformAdmin` | Global identity (no `tenant_id`) |
| `tenantMember` | Membership join table for session + tenant-admin invites |
| `laborEntry` | Mechanic scheduler nightly cross-tenant close only |
| `financeSettings` | Platform-admin new-tenant bootstrap only |
| `attendanceEvent` | HR attendance scheduler nightly close only |

Any new Prisma model is forbidden until it is added to `SYSTEM_PRISMA_MODEL_DELEGATES` **and** documented here with an explicit caller.

---

## Allowed Callers

| Caller | Delegates |
|---|---|
| `AuthSessionService` | `user` |
| `TenantMemberService` | `user`, `tenantMember` |
| `PlatformAdminService` | `tenant`, `financeSettings` (create-tenant transaction) |
| `MechanicSchedulerService` | `laborEntry` |
| `HrAttendanceSchedulerService` | `attendanceEvent` |

Do not inject `SystemPrismaService` into feature modules (customers, workshop, inventory, …). Use `PrismaService`.
