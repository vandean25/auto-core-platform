---
title: "ADR-0026: Tenant API Keys and the Read-Only Public API"
date: "2026-10-09"
status: accepted
deciders: "Product Owner, Engineering Team"
linear-project: "N/A"
linear-milestone: "E11 Public API foundation"
linear-issue: "AUT-411"
tags:
  - adr
  - api
  - security
  - auth
  - multi-tenancy
  - audit
---

# ADR-0026: Tenant API Keys and the Read-Only Public API

## Status

**Accepted — 2026-10-09.** Implements [AUT-411](https://linear.app/auto-core-platform/issue/AUT-411). Amends nothing. It builds on [ADR-0013](2026-04-15-row-level-multi-tenancy.md) (tenant isolation), [ADR-0022](2026-08-31-site-operational-scope.md) (site scope), [ADR-0010](2026-04-12-openapi-contract-first.md) (OpenAPI contract) and [ADR-0015](2026-05-26-audit-tracing-and-operational-logging.md) (audit tracing).

## Context

Integrations (dashboards, data exports, partner tools) need to read tenant data without a person signing in. Today every backend request is authenticated as a Firebase user, resolved to a `User` and a `TenantMember` row. There is no principal for a machine client, and no way to limit one to a few read scopes. Without that, an integration would need a shared employee login.

The public API must be small, read-only and deny by default. A key must never reach a session-only route, must never read another tenant, and must leave an audit trail. The secret must never be stored or logged.

## Decision

### 1. Principal model

- A **tenant API key** is a row in `tenant_api_keys` bound to exactly one tenant. It authenticates a **service principal** with no `User`.
- The request runs as `{ role: 'API_KEY', apiKeyId, tenantId }`. `API_KEY` is not a `TenantMemberRole`, so every existing role check denies it.
- `ApiKeyAuthGuard` is a global guard. It runs before the Firebase `JwtAuthGuard`. It only handles Bearer tokens that start with `acp_live_`. Session tokens take the existing path unchanged.
- **Deny by default.** A route is callable with a key only when it carries `@RequirePublicApiScope(scope)`. Any other route rejects a key with **403**, and the attempt is audited.

### 2. Token format and secret

- Token: `acp_live_<keyId>_<secret>`. `keyId` is the row UUID. It is a public lookup handle, not a secret. `secret` is 32 random bytes encoded as 64 hex characters (256 bits).
- The full token is returned **once**, in the create response. The list endpoint returns only `keyPrefix` (`acp_live_` plus the first 8 characters of `keyId`) and metadata.

### 3. Hashing

- `secret_hash = HMAC-SHA256(pepper, "<keyId>:<secret>")`, hex. `hash_version = 1` records the scheme.
- The pepper is `API_KEY_PEPPER`: optional, base64, at least 32 bytes. It is loaded through the same secret pattern as the other server secrets (GSM mapping, then env). If it is unset, creation returns **503** and every key is rejected. This is fail-closed, and boot does not depend on it. Test runs use a random per-process pepper, as the test JWT secret does.
- The key id is inside the MAC input, so a digest cannot be moved onto another row.
- Verification uses `crypto.timingSafeEqual` on the 32-byte digests. Every failure to verify returns the same `401 Invalid API key.`, so the response does not reveal which step failed.
- **Why HMAC and not argon2id.** The secret is 256 bits of CSPRNG output, so offline guessing is not feasible and no key-stretching is needed. A keyed fast digest keeps the per-request cost to microseconds. argon2id would add CPU cost on every request without changing the risk.

### 4. Pre-tenant lookup (documented exception)

The key row names its tenant, so the first read happens before any tenant context exists. That read is `ApiKeyLookupService.findForVerification(keyId)`, which calls `findUnique` by id on the unextended `SystemPrismaService`. It is the **only** pre-tenant read of `TenantApiKey`. It is listed in the system-client allow-list ([system-prisma-allowlist runbook](../05-Runbooks/system-prisma-allowlist.md)). Every later query runs through `PrismaService` with the resolved tenant, and the tenant-isolation extension scopes it.

### 5. Scope naming

- Read scopes are `<resource>:read`, kebab-case resource names. v1: `customers:read`, `vehicles:read`, `invoices:read`, `workshop-orders:read`, `stock:read`.
- Write scopes will be `<resource>:write`. They need an amendment to this ADR and their own review. No wildcard scopes exist.
- The scope set is a closed enum in `public-api-scopes.ts`. Creation rejects anything outside it.

### 6. Request decision order

For a Bearer `acp_live_` token, `ApiKeyAuthGuard` applies these checks in order:

| Step | Failure | Response | Audited |
|---|---|---|---|
| Parse and verify the secret | malformed, unknown id, wrong secret, tenant inactive, no pepper | 401 `Invalid API key.` | no (the key cannot be attributed) |
| Revoked or expired | `revoked_at` set, or `expires_at` in the past | 401 `Invalid API key.` | yes, `REFUSED` |
| Route scope mapping | route has no `@RequirePublicApiScope` | 403 `API keys are not accepted on this endpoint.` | yes, `REFUSED`, action `public_api.unmapped` |
| Scope held | key lacks the route scope | 403 `API key is missing the <scope> scope.` | yes, `REFUSED` |
| Per-key budget | window exhausted | 429 plus `Retry-After` (seconds) | yes, `REFUSED` |
| Admitted | `last_used_at` written at most once per 5 minutes | handler runs | yes, real status, by the audit interceptor |

Revocation takes effect on the next request, because no key state is cached.

### 7. Site semantics in v1 (tenant-wide key)

A key is tenant-wide, because it has no user and no site membership. Site-owned data is therefore returned for the tenant's **active** sites:

- `workshop-orders`, `stock` and `invoices` filter on `site_id IN <active sites>`.
- Site-less rows (legacy invoices and workshop orders with `site_id IS NULL`) are tenant-level and are included.
- Vehicle identity is tenant-wide, as in CRM. Dealer-stock fields (lot, status, cost basis, reservation) are never serialised.

Per-site key restriction is a **follow-up**. Until it exists, an integration that is meant for one site should get its own key only after that restriction ships.

### 8. Rate limit

- Fixed window of one minute per key. The budget is `Tenant.api_rate_limit_per_minute`, default 60, with a check of 1 to 6000. Each key has its own counter (`rate_window_count`, `rate_window_expires_at`).
- Each step is a single conditional `UPDATE`, so concurrent requests cannot overspend the budget. A conservative denial at the window boundary is acceptable.
- Trade-off: one row write per request. At 60 requests per key per minute this is acceptable. A Redis-backed limiter is a follow-up if volume grows.
- The tenant budget is set in the database for now. A settings field is a follow-up.

### 9. Audit

- **Requests.** Each verified-key request writes one `agent_action_logs` row. It has `actor_type = API_KEY`, `api_key_id`, `action_type = public_api.<scope>` (or `public_api.unmapped`), the route template, method, scope, `keyPrefix`, HTTP status and a reason for refusals. It never stores the token or the digest.
- **Lifecycle.** Key creation and revocation write `audit_logs` entries (`entity_type = TenantApiKey`, `CREATE` or `UPDATE`). The snapshot holds id, name, key prefix, scopes and dates, and never the digest or the token.
- The secret is returned once and not logged. The HTTP logging interceptor records only request id and user agent. Sentry `beforeSend` removes the `Authorization` header.

### 10. Rotation

- **Key rotation** (routine). Create a new key, switch the integration to it, then revoke the old key. Revocation is immediate. A key's secret is never rotated in place.
- **Pepper rotation** (exceptional). Changing `API_KEY_PEPPER` invalidates every digest, so all keys must be re-issued. `hash_version` exists so a future version can verify both old and new digests during a window. v1 does not implement dual verification.
- **Expiry.** `expiresAt` can be set at creation. It must be in the future. A past expiry is treated as revoked.

### 11. Tenant isolation

- Every query after verification runs through `PrismaService` with the resolved `tenant_id`, and the tenant-isolation extension injects it. Explicit `tenant_id` predicates are also present.
- The allow-list entry above is the only exception. `lint:prisma-tenant` passes.
- The e2e suite covers cross-tenant reads by id and by list, revoking another tenant's key, and the 403 and 401 paths.

### 12. OpenAPI

- The bearer scheme `PublicApiKey` is registered in `generate-openapi.mjs`. It is **not** a global requirement. Each `/api/public/v1` operation names it, and documents its scope in `x-required-scopes`.
- Session-only routes keep the global `BearerAuth` requirement only. They do not list `PublicApiKey`.

## Consequences

**Positive**

- Integrations get least-privilege, read-only, revocable access without a user login.
- Deny by default keeps the blast radius of a leaked key to its scopes and tenant.
- Every request is attributable to a key id and a route.

**Negative**

- Each API request costs a few extra database operations: the key lookup, the rate-limit update, the audit row, and at most one `last_used_at` write per five minutes.
- Site-owned data is tenant-wide until per-site keys ship.
- Pepper rotation is a mass re-issue.

**Operational prerequisites (before enabling in an environment)**

- Create the `API_KEY_PEPPER` secret in GSM (32 random bytes, base64) and mount it on the core-api service.
- Until then, creation returns 503 and keys are rejected. Nothing else changes.

## Alternatives Considered

| Option | Why not |
|---|---|
| Firebase custom tokens per integration | Still bound to a user identity. Cannot be scoped or revoked without the user. |
| OAuth client-credentials | Out of scope for v1. Adds a token-exchange flow and client registration for a single internal consumer model. |
| Store the secret encrypted and show it again | Adds a decryption path to recover a secret that nobody needs once issued. Hashing is enough. |
| argon2id for the digest | Adds per-request CPU cost with no gain for 256-bit random secrets. |
| Redis-backed rate limiter | Better at high volume, but adds an infrastructure dependency. Deferred. |
| Add `TenantApiKey` to the auto-audited model list | Its snapshots would carry the digest. Explicit audit entries exclude it by construction. |

## References

- [ADR-0013: Row-Level Multi-Tenancy](2026-04-15-row-level-multi-tenancy.md)
- [ADR-0022: Site Is Request-Scoped Operational Ownership](2026-08-31-site-operational-scope.md)
- [ADR-0010: OpenAPI Contract-First Development](2026-04-12-openapi-contract-first.md)
- [ADR-0015: Audit Tracing and Operational Logging](2026-05-26-audit-tracing-and-operational-logging.md)
- [System Prisma allow-list runbook](../05-Runbooks/system-prisma-allowlist.md)
- [Entity deletion policy](../../deletion-policy.md)
- Code: `apps/core-api/src/public-api/`, `apps/core-api/src/config/env.ts` (`API_KEY_PEPPER`), `apps/core-api/src/prisma/system-prisma.types.ts`

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | N/A |
| Milestone | E11 Public API foundation |
| Issues | [AUT-411](https://linear.app/auto-core-platform/issue/AUT-411) |
