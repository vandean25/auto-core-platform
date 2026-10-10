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
| `financeSettings`, `inspectionTemplate`, `inspectionTemplateItem` | Platform-admin new-tenant bootstrap only; writes use the new tenant ID |
| `attendanceEvent` | HR attendance scheduler nightly close only |
| `agentPolicyRule` | Agent policy platform-default rows (`tenant_id` null) only |
| `tenantApiKey` | Public API key verification only: one `findUnique` by key id before any tenant context exists (ADR-0026). The key row names its tenant. Every later query runs through `PrismaService`. |

Any new Prisma model is forbidden until it is added to `SYSTEM_PRISMA_MODEL_DELEGATES` **and** documented here with an explicit caller.

---

## Allowed Callers

| Caller | Delegates |
|---|---|
| `AuthSessionService` | `user` |
| `TenantMemberService` | `user`, `tenantMember` |
| `PlatformAdminService` | `tenant`, `financeSettings`, `inspectionTemplate`, `inspectionTemplateItem` (create-tenant transaction) |
| `MechanicSchedulerService` | `laborEntry` |
| `HrAttendanceSchedulerService` | `attendanceEvent` |
| `AgentPolicyService` | `agentPolicyRule` (read platform defaults only) |
| `ApiKeyLookupService` | `tenantApiKey` (`findUnique` by id, pre-tenant key verification only; ADR-0026) |

Do not inject `SystemPrismaService` into feature modules (customers, workshop, inventory, …). Use `PrismaService`.
