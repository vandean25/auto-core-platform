---
title: "ADR-0012: Parts Kitting and Tote Staging End-to-End Workflow"
date: "2026-04-15"
status: proposed
deciders: "Product Owner, Architecture, Backend Lead, Frontend Lead"
linear-project: "Auto Core Platform"
linear-milestone: "Project 1 - Parts Kitting & Tote Staging"
tags:
  - adr
  - inventory
  - workshop
  - warehouse
  - ux
  - api
---

# ADR-0012: Parts Kitting and Tote Staging End-to-End Workflow

## Status

**Proposed** - 2026-04-15

## Context

Project 1 introduces a warehouse execution workflow for workshop operations: staff must pick required parts for approved workshop orders and stage them into fixed physical totes, then mechanics consume staged parts later during task execution.

The platform must satisfy two constraints simultaneously:

1. **Backend integrity:** all stock movement remains ledger-based and auditable, with no direct stock mutation shortcuts.
2. **Frontend muscle memory:** the same interaction pattern is used every time so warehouse users can execute picks quickly with low error rates.

Existing architecture already defines critical invariants:

- Inventory is append-only ledger based (ADR-0002).
- State transitions require atomic guards (ADR-0011).
- Real-time updates are opt-in by entity (ADR-0001).
- OpenAPI is contract source of truth (ADR-0010).

This ADR defines one coherent decision spanning schema, service behavior, API contracts, and UX behavior for parts kitting and tote staging.

## Decision

We will implement Parts Kitting and Tote Staging as a **single, ledger-compliant transfer workflow** with fixed tote locations and a standardized pick drawer UX.

### 1. Scope and Ownership

- Primary module ownership: **Workshop** (execution trigger and order context).
- Cross-module dependencies: **Inventory** (ledger transfer), **Dashboard/Realtime** (optional event emission), **Frontend Shared UI** (DataTable, Sheet, Action placement).
- This ADR is the implementation source of truth for Project 1 end-to-end behavior.

### 2. Data Model and Schema Changes

#### 2.1 Storage Location Type

- Extend `LocationType` enum with `staging_tote`.
- `staging_tote` is a first-class location type and participates in normal inventory transfer flows.

#### 2.2 Fixed Tote Seed Set

- Seed `StorageLocation` records for a permanent tote pool (`TOTE-001` through `TOTE-050`).
- Tote records are immutable master data in practice: no ad hoc user-created tote IDs in Project 1.
- Seeding must be idempotent (`upsert`/natural-key guarded) so repeated runs do not duplicate records.

#### 2.3 Workshop Order Link

- Add optional `stagingLocationId` on `WorkshopOrder` with relation to `StorageLocation`.
- Relation semantics:
  - Nullable at order creation.
  - Populated when a tote is assigned through pick execution.
  - May be reassigned only through the controlled pick workflow (not raw edit endpoints).

Naming rationale: `stagingLocationId` aligns with the relation target (`StorageLocation`) and avoids introducing an extra noun (`Bin`) into the workflow vocabulary.

#### 2.4 Migration and Backward Compatibility

- Migration is additive and non-breaking:
  - New enum value.
  - New nullable FK column.
- Existing workshop orders remain valid with `stagingLocationId = null`.

### 3. Inventory Movement Invariants (Non-Negotiable)

All part movement from shelf/bin to tote must run inside one `prisma.$transaction` and produce ledger traceability.

#### 3.1 Atomic Transfer Unit

A single pick line movement must execute as one atomic unit:

1. Validate source availability policy (allow negative stock behavior follows ADR-0002).
2. Write source deduction ledger entry (`TRANSFER_OUT`, signed negative quantity).
3. Write destination addition ledger entry (`TRANSFER_IN`, signed positive quantity).
4. Update derived `InventoryStock` cache through the ledger service path only.
6. Persist workshop-tote linkage (`WorkshopOrder.stagingLocationId`) when applicable.

If any step fails, the whole unit rolls back.

Implementation requirement: this MUST use Prisma interactive transactions via `prisma.$transaction(async (tx) => { ... })`, not a sequential transaction array. The pick flow requires in-transaction reads and allocation decisions before final writes.

#### 3.2 Ledger Representation of "TRANSFER"

User-facing language may describe one transfer action, but ledger representation is **paired entries** (`TRANSFER_OUT` + `TRANSFER_IN`) linked by a common transfer group/reference ID. This preserves ADR-0002 taxonomy and auditability.

For avoidance of naming ambiguity: this project uses `InventoryTransaction` as the ledger table/entity. Any reference to "InventoryLedger" in user stories maps to `InventoryTransaction`.

#### 3.3 Service Boundary Rule

No controller/service may directly mutate `InventoryStock.quantity_on_hand`. All stock effects must be routed through inventory ledger service utilities.

### 4. API Contract

#### 4.1 Endpoint

- `POST /api/workshop/:id/pick-parts`

#### 4.2 Request Contract

- `destinationBinId: string`
- `items: Array<{ workshopTaskLineItemId: string; quantity: number; sourceLocationId?: string }>`

Notes:

- If `sourceLocationId` is omitted by the frontend, the backend Inventory Ledger Service MUST apply an automatic allocation strategy inside the same transaction boundary:
   - FIFO allocation by stock age, or
   - deterministic location-priority allocation.
- The allocator MUST be able to split a single requested quantity across multiple source locations seamlessly (for example, Shelf A + Shelf B) and still produce a single successful pick operation when aggregate available stock satisfies the request.
- Quantity must be positive decimal/integer per existing unit conventions.

#### 4.3 Response Contract

- Returns updated workshop order aggregate minimum:
  - `id`
   - `stagingLocationId`
  - pick execution summary (moved lines, rejected lines if partial strategy is ever enabled)

Project 1 default: fail the entire request on first invalid line (no partial success).

#### 4.4 Error Contract

- `400` for malformed payload/invalid quantities.
- `404` for missing workshop order, tote, or line item.
- `409` for state/concurrency conflicts (guard mismatch, already picked by another user).
- `422` for business rule violations (e.g., order not in an eligible status).

#### 4.5 Contract Regeneration Checklist

Any backend DTO or route change must regenerate and commit:

1. `openapi.json`
2. Frontend generated API types/clients
3. Affected query/mutation key typing

### 5. Workflow State and Concurrency Guards

#### 5.1 Eligible Order States

Pick execution is allowed only for approved intake-stage orders. For Project 1, the allowed set is:

- `INTAKE`
- `IN_PROGRESS`

Disallowed states (`SCHEDULED`, `COMPLETED`, `INVOICED`) must fail with explicit error.

#### 5.2 Guard Pattern

Use `updateMany` atomic guard pattern from ADR-0011 when transitioning or stamping order-level fields that depend on current status. Race losers must return `409` and frontend must refresh order detail.

### 6. Frontend UX Contract (Muscle Memory)

#### 6.1 Pick List

- Warehouse pick queue is rendered as standard `DataTable`.
- Rows show approved workshop orders requiring parts.
- Row click opens a right-side `Sheet` (shadcn/ui) for pick execution.

#### 6.2 Pick Drawer

Drawer content includes:

- Required parts from `WorkshopTaskLineItem`.
- Quantity controls per line.
- Staging tote selector (combobox bound to seeded tote locations).

#### 6.3 Primary Action Placement

Primary action button is in the **top-right corner of the Drawer header**.

- Label standard for Project 1: `Confirm Pick`.
- Placement is mandatory to preserve user muscle memory across modules.

#### 6.4 Feedback and Cache Behavior

- On success: Sonner success toast and close/refresh behavior per existing workshop detail convention.
- On success: invalidate workshop order detail cache for the specific order.
- On `409`: show conflict toast and force refetch.

### 7. Real-Time Sync Decision

Project 1 will rely primarily on mutation-driven query invalidation. WebSocket updates are optional for this first phase and are not required for correctness.

If later enabled, add mapping updates in both places:

- Backend `SUPPORTED_ENTITY_TYPES`
- Frontend `entityToDashboardSourceKeys`

### 8. Deletion Policy and Data Governance

No new entity type is introduced; therefore deletion-policy expansion is not required for Project 1.

Governance constraints:

- Totes are master records; delete is blocked in normal operations.
- Ledger records from pick transfers are immutable.
- Workshop order deletion constraints remain governed by existing workshop policy.

### 9. Testing and Verification Requirements

Minimum acceptance coverage:

1. **Schema/migration**
   - Enum and nullable FK migrate cleanly.
   - Seed creates exactly configured tote set idempotently.

2. **Backend transactional integrity**
   - Successful pick writes paired transfer ledger entries and updates derived stock.
   - Failure at any write point rolls back all writes.

3. **Concurrency**
   - Dual pick attempts on same order/line produce one success and one `409` conflict.

4. **API contract**
   - OpenAPI and generated client types reflect endpoint and payload.

5. **Frontend workflow**
   - DataTable row opens Sheet.
   - Tote combobox required before submit.
   - Primary button visible at top-right header.
   - Success and conflict toasts displayed.

### 10. Implementation Sequence (Normative)

1. Schema enum + `WorkshopOrder.stagingLocationId` migration.
2. Tote seed data with idempotent guard.
3. Backend pick endpoint with transaction and ledger calls.
4. OpenAPI regeneration and frontend type generation.
5. Frontend mutation hook and cache invalidation.
6. Drawer UI implementation with required action placement.
7. End-to-end verification.

## Consequences

### Positive

- Enforces strict ledger compliance while supporting real warehouse flow.
- Creates predictable, repeatable UX interaction for warehouse operators.
- Maintains architectural consistency with existing ADRs and avoids one-off exceptions.
- Provides clear rollout order that reduces integration ambiguity.

### Negative

- Adds cross-module coordination overhead (Workshop, Inventory, API contract, Frontend).
- Fixed tote pool may require operational expansion process when capacity is exceeded.
- Strict all-or-nothing pick behavior may block execution when one line is invalid.

### Neutral

- Real-time socket propagation is deferred in Project 1 without loss of correctness.
- `stagingLocationId` remains optional to preserve compatibility with older orders.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Single comprehensive ADR (chosen) | One authoritative execution reference across backend + frontend; lower ambiguity during delivery | Larger document with broader ownership; requires discipline to keep updated |
| Split into separate ADRs (schema/inventory/backend/frontend) | Smaller focused documents and deciders per concern | Higher risk of drift and contradictory rules across docs |
| Feature spec only, no ADR | Faster drafting; easier for short-lived work | Insufficient architectural governance for transaction invariants and long-lived workflow rules |

## References

- `01-ADR/2026-04-12-ledger-based-inventory.md` (ADR-0002)
- `01-ADR/2026-04-12-atomic-status-transition-guards.md` (ADR-0011)
- `01-ADR/2026-04-12-prisma-extends-realtime-sync.md` (ADR-0001)
- `01-ADR/2026-04-12-openapi-contract-first.md` (ADR-0010)
- `02-Feature-Specs/Workshop/workshop-order-lifecycle.md`
- `04-Database/state-machines.md`

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | Auto Core Platform |
| Milestone | Project 1 - Parts Kitting & Tote Staging |
| Issues | To be linked at implementation kickoff |
