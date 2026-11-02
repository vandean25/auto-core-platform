---
title: "ADR-0034: Custom Tenant Roles and Permission Catalogue"
date: "2026-11-02"
status: proposed
deciders: "Dejan Dosenovic (Product Owner), Engineering Team"
tags: [adr, auth, permissions, multi-tenancy, mcp]
---

# ADR-0034: Custom Tenant Roles and Permission Catalogue

## Status

**Proposed — 2026-11-02.** Replaces the external custom-roles draft with a proposal for review; this PR changes documentation only. Acceptance would amend the role model in [ADR-0013](2026-04-15-row-level-multi-tenancy.md), the role-derived mechanic session rules in [ADR-0014](2026-04-27-mechanic-digital-repair-order-tablet-rbac.md), and the proposal boundary in the [agent policy](../02-Feature-Specs/Platform/agent-policy.md), [MCP](../02-Feature-Specs/Platform/mcp-server.md), and [pending-actions](../02-Feature-Specs/Platform/pending-actions.md) specifications. Their current behavior remains authoritative until the corresponding implementation ships. [ADR-0022](2026-08-31-site-operational-scope.md) isolation and [ADR-0026](2026-10-09-public-api-keys.md) service-principal semantics remain unchanged.

## Context

Tenant membership currently has one `TenantMemberRole`: OWNER, ADMIN, TECH, SALES, or DEMO. Backend services and frontend predicates repeat role lists. A parts manager cannot receive stock and work on purchasing without inheriting unrelated rights from a broad existing role.

The target is tenant-defined roles, several roles per member, and the union of their permissions. Roles belong to a tenant, not a site. There is no interim fixed parts-manager role. Agents may prepare role proposals, but only an authorized OWNER or ADMIN may approve and apply them.

The migration must preserve more than allow-lists. Today the JWT guard blocks TECH from non-mechanic endpoints, DEMO has a restricted set of permitted mutations, mechanic services check employee identity and task assignment, and site services enforce operational scope. HUMAN_ONLY actions are refused by both the MCP pipeline and proposal approval; a tool named `propose_*` does not bypass that rule.

## Decision Drivers

- Grant individual business operations without granting a broad administrative role.
- Keep tenant, site, employee identity, task assignment, and business-state checks authoritative.
- Make revocation effective on the next request without waiting for token refresh.
- Prevent owner lockout, stale approvals, and concurrent edits restoring revoked access.
- Roll out without two competing authorization sources or accidental changes to API keys.

## Decision

### 1. Operation-based permission catalogue

Permissions are stable, versioned identifiers defined in code, with German (de-AT) source labels and English translations. They describe operations, such as `stock.read`, `stock.receive`, `stock.adjust`, `purchase.order.create`, and `purchase.order.receive`. Receipt and adjustment remain separate permissions even when their legacy role lists are identical. Avoid a broad `invoice.manage` permission where read, draft editing, and finalization must be independently grantable.

Before implementing the guard, inventory every protected route and shared service entry point. The resulting operation-to-permission table records the required permission, legacy effective access, tenant/site scope, additional domain checks, and accepted principal type. Include routes currently protected only by authentication and global TECH/DEMO restrictions, not just methods with explicit role comparisons. Calls from MCP, jobs, and internal workflows need an explicit principal policy; they do not acquire user rights by omitting a guard.

A backend permission resolver and guard use the active tenant membership from authenticated context. Unclassified protected domain operations and unknown permission identifiers fail closed. Public routes, session/recovery routes, platform administration, service jobs, and API-key routes have explicit policies; they are not silently treated as ordinary tenant members. The existing public-API route allow-list remains in force.

### 2. Effective access and profiles

For an active tenant member, permission candidates are the union of assigned active roles plus any protected OWNER or DEMO baseline described below. Apply the DEMO restriction after that union. An ordinary member with no roles has no domain permissions; narrowly defined own-session and authorized context-selection operations remain available.

A granted permission is necessary, but does not replace tenant isolation, active site membership and persisted document ownership, employee identity, task assignment, fiscal locks, or other business rules. OWNER/ADMIN do not gain cross-site access through the catalogue. New role assignments must never create site membership implicitly.

TECH becomes a protected system role, with no TECH membership flag. Mechanic operations require their specific permissions, an active linked MECHANIC employee resolved server-side, and existing task-assignment/projection checks. Replacing `@MechanicAccessible` and the global TECH restriction requires explicit permissions on back-office operations; removing the old restriction alone is unsafe.

`uiProfile = MECHANIC` selects the simplified shell when all assigned roles are mechanic profiles; a non-MECHANIC role selects the full shell. A profile changes presentation only. Opening the full shell does not grant an operation, expose financial fields, or bypass mechanic identity checks. OWNER uses the full shell; DEMO retains its existing demo presentation. Empty-role members receive a no-access state rather than a privileged default.

### 3. Data model and protected baselines

| Model | Required data and constraints |
|---|---|
| `TenantRole` | UUID, `tenant_id`, name, permission identifiers, nullable `system_key`, `ui_profile`, `version`, `is_active`, timestamps. Unique `(tenant_id, id)` and `(tenant_id, system_key)` for non-null system keys. Catalogue validation rejects unknown permissions. |
| `TenantMemberRoleAssignment` | `tenant_id`, member ID, role ID, timestamp; unique `(tenant_id, member_id, role_id)`. Composite foreign keys to the member and role include `tenant_id`, preventing cross-tenant assignments. |
| `TenantMember` additions | Protected `is_owner` and `is_demo` flags and `authorization_version`. The version advances on assignment or flag changes and membership activation/deactivation. Existing demo expiry remains enforced. |

There are **three protected system roles: ADMIN, TECH, SALES**. Their system keys, permissions, profiles, and active state are code-managed, not editable through role CRUD. Names alone confer no authority. New tenants receive the same protected definitions as migrated tenants.

OWNER and DEMO are flags with code-defined permission baselines, not assignable system roles. Backfill OWNER from its own legacy effective access, including nondelegable role/membership administration and approval rights; those rights cannot disappear when assignments are cleared. Backfill DEMO from its existing permitted operations, retaining expiry and the restriction mask, including the current permitted demo writes. A second role cannot lift that mask. The code-defined baselines and system roles receive new permissions only through an explicit catalogue migration and reviewed access-matrix change, never through a wildcard.

The OWNER flag cannot be granted or removed by role CRUD, assignment APIs, or MCP proposals. Ownership transfer is a separate human-only operation: activate/validate the successor, grant ownership, then relinquish the prior ownership atomically. All membership disable/delete and ownership paths must preserve at least one active, non-demo owner with the protected administration baseline. Clearing the last owner's role assignments must leave administration available. A recovery procedure for loss of the owner's login must authenticate the claimant through the existing identity/support process and audit the ownership change; ordinary admin endpoints provide no recovery bypass.

### 4. Management, concurrency, and audit

Direct role definition edits require `role.manage`; assignment edits require `member.roles.manage`. Both also require the OWNER flag or the protected ADMIN system role. Role-proposal approval additionally requires `role.proposal.approve` and that same OWNER/ADMIN eligibility; generic supervision access is insufficient. All checks use current database state, not a role name or JWT claim. DEMO cannot manage or approve roles.

An actor may create, edit, or assign only a complete resulting role permission set contained in their own current effective permissions. An update to a shared role is a permission change for every assigned member. It uses the same checks and notification path as direct assignment. Protected flags and platform-admin authority are not grantable catalogue entries.

`TenantRole.version` fences definition edits and archive operations. `TenantMember.authorization_version` independently fences assignment-set replacement and member activation changes. Assignment APIs and proposals carry the expected member version and versions of all referenced roles; a role version alone cannot detect an intervening member revocation.

All role, assignment, ownership, and membership-activation mutations serialize on the tenant row before locking dependent rows, in a consistent order. In the same transaction, re-read the actor's active membership, roles, current permissions and OWNER/ADMIN eligibility, validate tenant-safe references and expected versions, enforce owner protection, apply the mutation, and write an immutable audit entry. This also prevents a concurrent actor revocation from racing approval. Do not make external calls while holding these locks. Ordinary domain requests use a request-local permission snapshot; this design does not cancel work already authorized in flight.

An audit entry records the human actor, proposer when applicable, target, before/after permission or assignment set, relevant versions, and proposal correlation. Applied proposal state, audit, and authorization writes commit together. A stale direct edit returns a conflict; a stale proposal becomes non-applicable and must be regenerated. Duplicate approval cannot apply twice.

### 5. MCP proposal boundary: an explicit policy amendment

Read tools are `list_roles`, `list_permissions`, and `get_member_roles`. Role administration data and other members' assignments require the corresponding management access; the caller's own effective rights come from the session permission endpoint.

Proposal tools have dedicated policy actions:

| Tool | Proposal policy action | Payload fence |
|---|---|---|
| `propose_role_create` | `tenant_role.propose_create` | Exact proposed definition, catalogue version, and tenant-unique create identity |
| `propose_role_update` | `tenant_role.propose_update` | Exact resulting definition, expected role version, and affected member IDs with their authorization versions |
| `propose_role_assign` | `tenant_role.propose_assign` | Exact replacement assignment set, expected member authorization version, and referenced role versions |

These are new, explicitly registered proposal-submission actions, not alternate names for direct role mutation. They are PROPOSE-only when enabled; AUTO is clamped to PROPOSE and disabled/HUMAN_ONLY policy still refuses submission. The direct role-change/invite floors and never-exposed mutation actions remain unchanged. Unknown actions continue to fail closed.

Submission validates and builds a read-only before/after preview and stores a proposal; it never executes a role mutation, including through a rollback simulation. Editing a shared role previews affected members as well as permission changes. Its approval recomputes the complete assigned-member ID/version set under the tenant lock and refuses any mismatch, including a member added after preview. Every proposal also binds the catalogue version; a changed catalogue requires a new preview. Pending proposals grant no authority. The proposal-submission principal must have the corresponding management access, so MCP is not a way to request privileges its authenticated user could not manage directly.

Application is a separate, explicit human confirmation through the supervision UI and authenticated human approval endpoint. This is the narrow amendment to the current blanket refusal: the proposal policy is re-evaluated, then a dedicated role-approval handler applies the exact previewed change under section 4's current-state checks. It does not downgrade or route through the direct HUMAN_ONLY agent action. Approval must use a verified human session rather than an API-key, MCP-delegated, agent, or worker principal; a `userId` alone is insufficient evidence of that distinction. The implementation must pin that boundary in its authentication contract before enabling these tools. No MCP tool or background executor can invoke this handler, approve its own proposal, or replay a human approval as a reusable grant.

The implementation must update the policy catalogue, refusal/approval paths, capability reporting, MCP instructions, and the three linked agent specifications together. Until that work and its refusal tests pass, role proposal tools remain disabled. Human direct management can ship independently.

### 6. API, frontend, and permission refresh

`GET /api/me/permissions` returns the effective permission set, active tenant/member identity, resolved UI profile, and an opaque `permissionsVersion`. The version identifies the member authorization version, assigned role versions, flags, and catalogue version; it changes when any input changes. Permissions are resolved from the database once per request, with no cross-request cache or permission list in Firebase/JWT claims.

Frontend predicates, record actions, route guards, and navigation consume the same permission identifiers through a domain query-key factory. The tenant/member identity scopes the cached response. Refetch after 403, tenant changes, and authorization-change events. Role edits notify every affected member's private user room across tabs/devices, not just the editor. Reconnect refetches after missed events. On lost access or tenant change, remove affected cached domain data and close inaccessible views; a hidden button alone is insufficient. WebSocket subscriptions/projections also recheck changed authorization, so revocation covers subsequent events as well as HTTP requests.

The role editor belongs in the team settings tab: sortable/searchable role list, module-grouped permissions, multi-role assignments, conflict feedback, and explicit confirmation showing the affected permission/member set for a security change. Use explicit Save/Apply for authorization changes; this is a deliberate exception to document auto-save so intermediate checkbox edits cannot silently grant rights. Follow the compact-text rule, German/English i18n, shared components, and 375 px layout. Settings remain exempt from Cmd+K record-action parity.

Role/membership DTOs and session responses move to the multi-role contract in the rollout; no client invents a synthetic single role. Every API-contract change must regenerate and commit both OpenAPI and frontend generated types under ADR-0010. This documentation PR creates no routes or DTOs.

### 7. API keys: catalogue mapping only

Existing public scopes may map to catalogue identifiers, but API keys remain the independent, read-only tenant service principals of ADR-0026. Preserve the explicit public-route allow-list, per-key scopes, tenant-wide active-site semantics, revocation, expiry, budgets, and audit. Shared permission identifiers do not admit keys to session-only or role-management endpoints.

**Do not intersect key rights with the creator's permissions in this rollout.** Creator membership changes or departure must not change the existing key lifecycle. Creator-bound rights, per-site key restriction, write scopes, transfer of key responsibility, and missing/deactivated creator handling require a separate ADR-0026 amendment and migration review.

### 8. Lifecycle and deletion

Custom roles are archived (`is_active = false`), not hard-deleted through ordinary APIs. Archive is blocked while assignments exist; revoke/reassign members explicitly first, with member version checks and audit. Protected system roles cannot be archived. An archived role cannot be assigned. No role deletion or archive MCP tool is introduced here.

Assignments are removed only by the authorized, versioned membership operation; retain the immutable audit evidence. A proposal referencing a removed assignment, changed role, archived role, or changed member version cannot apply. Role rows remain available for historical audit/proposal references. Tenant purge follows the existing authorized purge and retention process; this ADR adds no exception to audit retention. Proposed entries are recorded in [the deletion policy](../../deletion-policy.md#adr-0034--custom-tenant-roles-proposed).

## Implementation and Rollout

Each phase needs its own reviewed implementation checklist and CI evidence. The earlier rough PR-count estimates are not delivery commitments: route coverage and principal boundaries determine the scope.

1. **Catalogue and legacy adapter.** Inventory every protected operation; derive distinct permissions from operation semantics. Initially resolve them exclusively from the legacy role and existing restrictions. Migrate backend/frontend consumers, session/profile handling, service callers, and realtime checks. Compare the full legacy effective matrix, including denied cases, before removing old checks. API-key mapping remains behavior-preserving.
2. **Expand and backfill.** Add roles, assignments, flags, and versions. Seed protected definitions with upserts on `(tenant_id, system_key)`; idempotent backfill inserts missing initial assignments/flags without overwriting later authorization edits. A completed backfill is recorded and never reinterprets a stale legacy role. Before cutover, legacy writes and their shadow data update atomically under the same tenant lock. Compare shadow resolution for all existing members, but authorize from the legacy adapter only. Custom writes remain disabled.
3. **Single-source cutover.** Switch all authorization readers to assignments/flags together, with incompatible old writers blocked or drained before serving requests; do not run mixed-authority application revisions. Keep the legacy column only for a pre-customization parity report, never for fallback, union, or single-role projection. Prove parity before enabling custom writes. Once customization starts, rollback is to a compatible assignments-based revision; restoring an old enum-based revision requires disabling access and a separately reviewed data migration. Dropping the old column is a later change.
4. **Human role management.** Ship CRUD/archive and multi-role assignment APIs, their version/owner/audit guards, then the team editor. Proposed permissions for new management operations are explicit additions to the baseline, distinguished from the unchanged legacy domain matrix. All auth-critical consumers must already use the new source before enabling this phase.
5. **MCP proposals.** Ship the policy amendment, read-only preview, dedicated human application boundary, queue integration, and refusal tests. Enable PROPOSE tools only after those checks pass. Never enable direct agent mutations as an intermediate step.

A static rule bans legacy role authorization outside the migration adapter/fixtures and bans ad hoc string comparisons as well as enum comparisons. OWNER/DEMO flags and protected system-role eligibility stay encapsulated in the authorization module. No schema or production rollout happens through this ADR PR.

## Validation Required Before Implementation Completion

The unchanged legacy matrix is one gate; the new composition and security behavior need additional tests:

| Case | Required result |
|---|---|
| OWNER, ADMIN, TECH, SALES, DEMO before/after cutover | Same legacy effective access, including authentication-only routes, denied back-office operations, permitted demo writes, and restricted projections. |
| Receipt-only custom role | May receive stock; cannot adjust it. The same separation holds for distinct purchase and invoice operations. |
| Several roles / empty assignments | Union grants only held operations; an ordinary empty-role member has no domain access. Clearing OWNER assignments preserves administration. |
| Cross-tenant role/member IDs | Rejected by services and composite foreign keys; no assignment or role data leak. |
| Site switch / foreign-site document | Permission grant never bypasses ADR-0022 active membership, document site, or nested projection rules. |
| Mechanic and mixed profiles | Employee identity, assigned-task checks, and restricted projections remain; choosing the full shell grants nothing. |
| DEMO plus ADMIN or custom write role / expired demo | Restriction mask and expiry still win. DEMO cannot manage roles or approve proposals. |
| Last-owner disable/delete/transfer; concurrent attempts | At least one active, non-demo owner with management authority remains; transfer is atomic and audited. |
| Shared-role edit / concurrent actor revocation | All affected users receive the change; authorization and the anti-escalation check use current serialized state. |
| Stale role/member version or changed shared-role member set; approval replay | No stale mutation, no restored revoked assignment, no new recipient omitted from the approved preview, and at most one application/audit result. |
| MCP submission, approval, and refusal | Submission changes no authorization. AUTO, disabled, HUMAN_ONLY, unknown actions, ineligible supervisors, delegated principals, and background execution cannot bypass their respective limits. |
| Browser caches / reconnect / WebSocket revocation | Every affected session refreshes; inaccessible cached views close and later restricted events stop. |
| Backfill rerun / legacy downgrade | Rerun never restores removed rights; legacy reads/writes cannot become authoritative after cutover. |
| API key after creator departure / session-only route | Existing scope/lifecycle behavior is unchanged; session and role-management routes still refuse the key. |
| Role archive and reference history | Assigned/system roles cannot be archived, archived roles cannot be assigned, and retained audit/proposal evidence survives. |

Backend module/integration tests and focused frontend tests cover these cases in the owning implementation phases. Run only changed E2E specs locally as required by repository policy; full suites run in CI. OpenAPI drift, tenant isolation, and action-parity checks remain mandatory where applicable.

## Consequences

### Positive

- Tenants can combine specific operations without granting ADMIN.
- One catalogue and one authoritative resolver replace duplicated role lists.
- Protected ownership, current-state approval, and immediate request-time lookup make revocation predictable.

### Negative

- Every authorization entry point, session consumer, and realtime projection needs migration; this is not a mechanical role-list replacement.
- Role administration adds transactional concurrency, audit, lifecycle, and cache-invalidation responsibilities.
- After customization, rollback cannot safely return to the old single-role model.

### Neutral

- Expected volume is small (about 50 roles and 200 members per tenant); request-local resolution and tenant-serialized administration are sufficient initially. Those figures are planning assumptions, not enforced limits.
- Site access, business-state rules, and service-principal policy remain separate constraints on a permitted operation.
- Implementation acceptance, API-key redesign, and any production rollout remain separate from reviewing this proposal.

## Alternatives Considered

| Option | Benefit | Reason not selected |
|---|---|---|
| Add a fixed parts-manager role | Small immediate change | Does not support tenant-defined combinations or several roles per member. |
| One custom role per member | Simpler assignments | Does not meet the multi-role requirement; duplicates shared responsibility sets. |
| Persist permissions in JWT claims | Avoids request lookup | Revocation depends on token refresh and duplicates the permission source. |
| Dual-read the old enum and new assignments | Appears easier to roll back | Cannot represent custom combinations and can restore revoked privileges. |
| Change API keys to inherit creator rights now | One apparent permission formula | Changes independent service-principal lifecycle and site semantics; separate ADR review is needed. |

## References

- [ADR-0010: OpenAPI Contract-First Development](2026-04-12-openapi-contract-first.md)
- [ADR-0013: Row-Level Multi-Tenancy](2026-04-15-row-level-multi-tenancy.md)
- [ADR-0014: Mechanic Digital Repair Order Tablet RBAC](2026-04-27-mechanic-digital-repair-order-tablet-rbac.md)
- [ADR-0015: Audit Tracing and Operational Logging](2026-05-26-audit-tracing-and-operational-logging.md)
- [ADR-0022: Site Operational Scope](2026-08-31-site-operational-scope.md)
- [ADR-0026: Tenant API Keys](2026-10-09-public-api-keys.md)
- [Agent policy](../02-Feature-Specs/Platform/agent-policy.md), [MCP server](../02-Feature-Specs/Platform/mcp-server.md), [pending actions](../02-Feature-Specs/Platform/pending-actions.md)
- Current implementation anchors: [JWT guard](../../../apps/core-api/src/auth/jwt-auth.guard.ts), [member service](../../../apps/core-api/src/tenant-member/tenant-member.service.ts), [mechanic identity](../../../apps/core-api/src/mechanic/mechanic-identity.service.ts), [policy floor](../../../apps/core-api/src/agent-policy/agent-policy-floor.ts), [proposal approval policy](../../../apps/core-api/src/agent-proposal/agent-proposal-decision-policy.ts), [API-key guard](../../../apps/core-api/src/public-api/api-keys/api-key.guard.ts), [frontend action predicates](../../../apps/core-web/src/features/actions/action-role-predicates.ts).

## Linear Tracking

No implementation issue is assigned by this documentation PR. Create phase-specific issues after the proposal is accepted; API-key redesign remains a separate amendment.
