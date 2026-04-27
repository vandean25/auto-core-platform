---
title: "ADR-0014: Mechanic Digital Repair Order Tablet RBAC"
date: "2026-04-27"
status: proposed
deciders: "Product Owner, Architecture, Backend Lead, Frontend Lead"
linear-project: "Auto Core Platform"
linear-milestone: ""
tags:
  - adr
  - workshop
  - mechanic
  - rbac
  - tablet
  - digital-repair-order
  - inventory
  - real-time
  - media
---

# ADR-0014: Mechanic Digital Repair Order Tablet RBAC

## Status

**Proposed** — 2026-04-27

**Amended** — 2026-04-28 (labor-entry close-out, queue query-shape enforcement, media upload policy hardening, and advisor notification routing)

## Context

The Workshop module already models the repair journey through `WorkshopOrder`, `WorkshopTask`, task line items, mechanic/bay assignment, parts staging, and real-time dashboard updates. However, the current system is still oriented around office-style users and shared terminal workflows.

A high-end workshop ERP must digitize the shop floor directly at the bay. A mechanic using a tablet with dirty gloves must not need to walk to a shared workstation, print a paper work order, or navigate finance/customer screens that are irrelevant to the job.

The mechanic experience must be:

1. **Role-focused** — mechanics see assigned work, vehicle context, complaints, tasks, parts, checklists, notes, and evidence only.
2. **Touch-first** — high contrast, large targets, minimal navigation, and no dense back-office controls.
3. **Real-time** — when a mechanic starts, pauses, requests parts, or completes work, the Service Advisor board and dashboard update immediately.
4. **Secure by projection** — the backend must not return customer PII, part costs, labor rates, invoice totals, or global override actions to mechanic endpoints.
5. **Seamless across modules** — assignment comes from the workshop planner board, parts requisition flows through Inventory/Parts, time entries feed labor tracking, media goes to cloud storage, and completed work feeds invoicing without exposing financial controls to the mechanic.

Existing related decisions:

- [ADR-0001: Prisma `$extends` Real-Time Sync via WebSocket](2026-04-12-prisma-extends-realtime-sync.md)
- [ADR-0006: Form Auto-Save Patterns](2026-04-12-form-auto-save-patterns.md)
- [ADR-0012: Parts Kitting and Tote Staging End-to-End Workflow](2026-04-15-parts-kitting-and-tote-staging.md)
- [ADR-0013: Workshop Planner Kanban Board](2026-04-18-workshop-planner-kanban-board.md)
- [Row-Level Multi-Tenancy](2026-04-15-row-level-multi-tenancy.md) *(linked document title: ADR-0013; use the filename/title as the stable reference until numbering is reconciled)*
- [Database State Machines](../04-Database/state-machines.md)

## Decision

We will introduce a **Mechanic Digital Repair Order** execution layer for tablet users. This is not a simplified copy of the office Workshop Order detail page; it is a role-specific surface with dedicated backend projections, RBAC checks, and touch-first UX.

### 1. Scope and Ownership

- **Primary module:** Workshop.
- **Cross-module dependencies:** Inventory, Labor, Dashboard/Realtime, Auth/RBAC, Cloud Storage, OpenAPI-generated frontend API.
- **Frontend surface:** A mechanic tablet route group, for example `/mechanic/queue` and `/mechanic/orders/:id/tasks/:taskId`.
- **RBAC profile:** The mechanic profile is implemented as a restricted permission set for authenticated workshop users mapped to an active `Employee` with `role = MECHANIC`.
  - In the current tenant membership model this may map to `TenantMemberRole.TECH`.
  - Renaming or splitting auth roles into a literal `MECHANIC` role is out of scope for this ADR unless handled by a separate auth migration ADR.

### 2. Assignment Source of Truth

The mechanic queue must connect directly to assignment decisions made on the Workshop Planner board.

#### 2.1 Order-Level Assignment Remains the Planning Default

`WorkshopOrder.mechanic_id` and `WorkshopOrder.bay_id` remain the default assignment fields for board-level planning.

When the board assigns a whole order to a mechanic or bay, all incomplete child tasks are considered visible to that mechanic/bay unless a task-level override exists.

#### 2.2 Task-Level Assignment Is Added for Execution Precision

To support multiple mechanics on a single repair order, `WorkshopTask` will gain optional assignment fields:

- `mechanic_id` — nullable FK to `Employee` where `role = MECHANIC`.
- `bay_id` — nullable FK to `Bay`.
- `scheduled_date` — nullable date used by the current-day mechanic queue.
- `sequence` — deterministic ordering within the mechanic queue.

Resolution rule for queue visibility:

1. If `WorkshopTask.mechanic_id` is set, the task belongs to that mechanic.
2. Else if `WorkshopTask.bay_id` is set, the task belongs to mechanics assigned to or working in that bay context.
3. Else inherit `WorkshopOrder.mechanic_id` and `WorkshopOrder.bay_id`.
4. Tasks with no resolved mechanic or bay are not shown in a mechanic's personal queue, but remain visible to Service Advisors on the board.

This preserves the existing board model while enabling precise shop-floor task routing.

### 3. Mechanic Active Work Queue

Mechanics get a read-only, prioritized DataTable of current work.

#### 3.1 Query Scope

The queue endpoint returns only tasks that satisfy all conditions:

- Same `tenant_id` as the authenticated session.
- Assigned to the authenticated mechanic or their resolved bay context.
- Scheduled for the current day or currently active/blocked from a previous day.
- Parent `WorkshopOrder.status` in `INTAKE` or `IN_PROGRESS`.
- `WorkshopTask.status` not `DONE`.

#### 3.2 Queue Projection

The mechanic queue response must include only shop-floor context:

- Order number.
- Task title and task status.
- Vehicle year/make/model/license plate.
- Reported complaint.
- Bay.
- Parts readiness summary.
- Priority/sequence.
- Last updated timestamp.

The response must not include:

- Customer phone, email, address, or billing details.
- Labor sell rates, part costs, margins, invoice totals, tax totals, or payment state.
- Delete, override, invoice, or approval capabilities.

Implementation constraint:

- `GET /api/mechanic/queue` must be implemented as one Prisma `findMany` against `WorkshopTask` with a single query shape that includes the parent order and vehicle projection, for example:

```typescript
include: {
  workshop_order: {
    include: {
      vehicle: true,
    },
  },
  line_items: true,
}
```

- No secondary looping lookups are allowed. In particular, the endpoint must not fetch tasks first and then issue per-row queries for order, vehicle, labor, or parts data.
- Queue projection mapping happens in memory from the single result set.
- Parts readiness for the mechanic queue is derived from already-loaded part-line state such as `PENDING_PICK`, `STAGED`, `CONSUMED`, and `CANCELLED`, or from a precomputed order/task readiness field maintained by the workshop-parts workflow. The queue endpoint must not query live inventory row-by-row.

#### 3.3 TanStack Query Keys

Frontend data fetching must define a standardized query key factory:

```typescript
export const mechanicQueueKeys = {
  all: ['mechanic-queue'] as const,
  list: (filters: MechanicQueueFilters) => [...mechanicQueueKeys.all, 'list', filters] as const,
  detail: (taskId: string) => [...mechanicQueueKeys.all, 'detail', taskId] as const,
};
```

Inline hardcoded query key arrays are forbidden for the mechanic queue.

### 4. Time and State Management

Mechanic time tracking is modeled explicitly through `LaborEntry` records, not through free-text notes or direct task duration edits.

#### 4.1 New Entity: `LaborEntry`

A `LaborEntry` records actual work intervals against a `WorkshopTask`.

Minimum fields:

- `id`
- `tenant_id`
- `workshop_task_id`
- `employee_id`
- `started_at`
- `ended_at`
- `pause_reason` — nullable enum, e.g. `WAITING_PARTS`, `WAITING_CUSTOMER`, `AUTO_SHIFT_CLOSE`, `OTHER`.
- `createdAt`
- `updatedAt`

Rules:

- Only one open `LaborEntry` (`ended_at = null`) is allowed per mechanic at a time.
- `POST /api/mechanic/tasks/:taskId/start` must return `409 Conflict` if the mechanic already has an open `LaborEntry`.
- If the mechanic needs to move from one task to another while an open entry exists, they must use the explicit switch flow defined below.
- `LaborEntry` records are audit records. They are not hard-deleted in normal operations.
- Sell rates and internal cost rates are not returned to mechanic endpoints.

#### 4.1.1 Orphaned Labor Entry Close-Out

Forgotten punch-outs must not be allowed to generate infinite labor anomalies.

Implementation requirements:

- A NestJS scheduled task runs nightly at `23:59` and force-closes any `LaborEntry` records where `ended_at IS NULL`.
- The job sets:
  - `ended_at = now()`
  - `pause_reason = AUTO_SHIFT_CLOSE`
  - system-authored audit metadata indicating that the closure was automatic rather than mechanic initiated.
- The job must process candidate entries in bounded batches using the shared `chunkedPromiseAll` utility rather than one unbounded `Promise.all`.
- The job closes the active labor timer only. It does not auto-complete the task or order.
- The related task remains resumable on the next shift and must remain visible in the mechanic queue according to normal assignment and state rules.
- If tenant-local workshop timezones are introduced later, this scheduler must become timezone-aware rather than assuming one global clock.

#### 4.2 Punch In

When a mechanic taps **Start Task**:

1. Backend validates tenant, mechanic identity, assignment, and task state.
2. Backend creates a `LaborEntry` with `started_at = now()`.
3. Backend transitions `WorkshopTask.status` from `NOT_STARTED` to `IN_PROGRESS` using the atomic `updateMany` guard pattern.
4. Backend ensures the parent `WorkshopOrder.status` is `IN_PROGRESS` when work begins.
5. Prisma `$extends` emits real-time updates so the Service Advisor board reflects the task/order as in progress.

#### 4.2.1 Switch Task

When a mechanic taps **Switch Task** on a different task while an open `LaborEntry` exists:

1. The client calls `POST /api/mechanic/tasks/:taskId/switch` with `{ previous_pause_reason }`.
2. The backend closes the currently open `LaborEntry` for that mechanic.
3. The backend transitions the previous task out of `IN_PROGRESS` in the same transaction, using the supplied pause reason.
4. The backend opens a new `LaborEntry` for the target task in the same transaction.
5. The backend transitions the target task to `IN_PROGRESS` using the same atomic guard rules as `Start Task`.
6. The backend returns the updated target task projection.

Required payload field:

- `previous_pause_reason` — enum with values `WAITING_PARTS`, `WAITING_CUSTOMER`, and `SWITCHED_TO_HIGHER_PRIORITY`.

Task state mapping for the previous task:

- `WAITING_PARTS` → `WorkshopTask.status = WAITING_PARTS`
- `WAITING_CUSTOMER` → `WorkshopTask.status = WAITING_CUSTOMER`
- `SWITCHED_TO_HIGHER_PRIORITY` → `WorkshopTask.status = PAUSED`

Expected status codes:

- `200` or `201` on success, depending on the response shape used by the implementation.
- `404` if the target task does not exist or is not assigned to the mechanic.
- `409` if the mechanic does not have an open labor entry to switch from, or if a concurrent request already closed it.
- `422` if the target task is not eligible to start.

Client fallback behavior:

- If `POST /api/mechanic/tasks/:taskId/switch` returns `409 Conflict` because no open `LaborEntry` exists, the frontend mutation handler must refetch the task projection and retry the action as `POST /api/mechanic/tasks/:taskId/start`.
- If the retry also returns `409`, the client should surface the conflict and stop retrying.

#### 4.3 Pause

When a mechanic taps **Pause**:

1. Backend closes the active `LaborEntry` by setting `ended_at = now()`.
2. Backend records `pause_reason`.
3. Backend transitions task status based on reason:
  - `WAITING_PARTS` → `WorkshopTask.status = WAITING_PARTS`.
  - `WAITING_CUSTOMER` → add `WAITING_CUSTOMER` to `WorkshopTaskStatus` and transition to it.
  - `OTHER` → remain `IN_PROGRESS` but with no active labor entry, unless a future `PAUSED` state is approved.
4. Real-time events refresh the Service Advisor board and dashboard.

When a task transitions to `WAITING_CUSTOMER`, the backend must also publish a domain event onto the platform notification/event bus so the responsible Service Advisor receives the standard outbound contact notification flow (email and/or SMS). The workshop service must not send SMTP/SMS messages directly from the mutation handler.

This ADR also introduces `PAUSED` as the status for mechanic-initiated switch-outs where the previous task is intentionally shelved for a higher-priority job.

This ADR therefore proposes extending the task state machine with `WAITING_CUSTOMER` for customer-blocked work. The state machine documentation must be updated during implementation.

#### 4.4 Complete Task

The top-right primary action on the Digital Repair Order is a large **Complete Task** button.

When tapped:

1. Backend validates required inspection/checklist fields are complete, if the task requires them.
2. Backend closes any active `LaborEntry` for that task/mechanic.
3. Backend transitions `WorkshopTask.status` to `DONE` using an atomic guard.
4. If all tasks on the parent order are `DONE`, backend may transition `WorkshopOrder.status` to `COMPLETED`.
5. The mechanic still cannot invoice, finalize billing, approve estimates, or override customer approvals.

### 5. Diagnostic Notes and Digital Checklists

Mechanics may enter narrative diagnostic notes and structured inspection/checklist values.

#### 5.1 Auto-Save Pattern

The Digital Repair Order uses **Debounced Form-Level Auto-Save with a 750ms debounce**, consistent with ADR-0006.

Requirements:

- A persistent save indicator must show `Saving`, `Saved`, or `Error` near the action area.
- Pending auto-saves must be cancelled before explicit transitions such as Pause or Complete Task.
- Backend validation errors must surface through the save indicator and toast messaging.
- Local form state must not be cleared on transient network failure.

#### 5.2 Checklist Data Model

We will introduce structured inspection records rather than storing checklist values as opaque notes.

Minimum entities:

- `InspectionTemplate` — tenant-scoped checklist definition, versioned.
- `InspectionTemplateItem` — template row definitions such as tire tread depth or brake pad wear.
- `WorkshopInspection` — inspection instance linked to a `WorkshopOrder` and optionally a `WorkshopTask`.
- `WorkshopInspectionItem` — captured value, unit, pass/fail/severity, and notes.

Phase 1 may seed a fixed multi-point inspection template. A full template builder is explicitly deferred unless separately approved.

### 6. Parts Requisition

Mechanics can request required parts from the Digital Repair Order, but they cannot purchase, receive, or directly deduct global stock.

#### 6.1 Part Request Behavior

When a mechanic adds a required part:

1. Backend creates or updates a `WorkshopTaskLineItem` with `type = PART`.
2. The line is marked with a requisition status of `PENDING_PICK`.
3. Inventory stock is not deducted by this action.
4. Parts department queues use the existing kitting/tote staging workflow from ADR-0012.
5. When parts are picked/staged, Inventory writes paired ledger transfer entries and the mechanic tablet updates via real-time/cache invalidation.

#### 6.2 New Part Line Status

`WorkshopTaskLineItem` needs a part-line lifecycle for `type = PART` rows:

- `PENDING_PICK` — mechanic requested or advisor added; parts department has not staged it.
- `STAGED` — parts were picked into the order's staging tote.
- `CONSUMED` — part was installed/used on the job.
- `CANCELLED` — no longer required.

This status must not be used for `type = LABOR` rows.

#### 6.3 Inventory Search Projection

Mechanic inventory search must use a restricted projection:

Allowed:

- SKU/item number.
- Description.
- Vehicle/brand fitment context.
- Availability summary such as `Available`, `Low`, or `Ask Parts`.

Forbidden:

- Unit cost.
- Vendor cost.
- Margin.
- Global inventory valuation.
- Direct stock adjustment actions.

### 7. Media Uploads as Evidence

Mechanics can capture photos or short videos from the tablet camera to document damaged components and justify customer-facing upsells.

#### 7.1 Storage Decision

Media binaries must not be stored in PostgreSQL.

The backend provides presigned POST uploads, or the cloud-equivalent signed POST policy document, to cloud storage. Raw presigned PUT uploads are forbidden for mechanic media because they cannot enforce the same upload envelope constraints at the storage layer.

Required storage-layer policy constraints:

- `content-length-range` must cap the maximum upload size.
- Allowed `Content-Type` values must be explicitly whitelisted by media class.
- Object key/prefix must be tenant-scoped and order/task scoped.
- Expiration must be short-lived.

The tablet uploads directly to cloud storage using the signed POST policy and PostgreSQL stores only metadata and the storage URL/key. If short video support later requires multipart or resumable behavior, it must preserve the same storage-layer size and MIME-type constraints rather than falling back to an unconstrained signed PUT URL.

#### 7.2 New Entity: `WorkshopMedia`

Minimum fields:

- `id`
- `tenant_id`
- `workshop_order_id`
- `workshop_task_id` — nullable.
- `uploaded_by_employee_id`
- `storage_bucket`
- `storage_key`
- `public_or_signed_url` strategy metadata.
- `mime_type`
- `size_bytes`
- `duration_seconds` — nullable, for video.
- `caption`
- `createdAt`

Rules:

- Mechanics may create media for assigned work only.
- Mechanics may not delete evidence once the order is completed; deletion/retention must follow policy.
- The customer-facing layer may later choose which media is shared externally, but mechanics do not directly send media to customers in this ADR.

### 8. RBAC and Security Boundaries

Mechanic endpoints must enforce permission boundaries server-side. The tablet UI hiding fields is not sufficient.

#### 8.1 Mechanics Can

- View their assigned task queue.
- Open a Digital Repair Order for assigned tasks.
- Start, pause, resume, and complete assigned tasks.
- Add/edit diagnostic notes and checklist values.
- Request parts for assigned tasks.
- Upload media evidence for assigned orders/tasks.

#### 8.2 Mechanics Cannot

- View customer PII: phone, email, home address, billing address.
- View financials: hourly sell rate, part cost, margin, invoice totals, tax, payment status.
- Delete tasks, orders, customers, vehicles, parts, or media evidence after completion.
- Approve estimates or customer-facing upsells.
- Purchase, receive, or globally adjust inventory.
- Override lock dates, workflow states, or assignment constraints.
- Access tenant/team/platform administration.

#### 8.3 Tenant Isolation

Every mechanic endpoint must obtain `tenantId` from the tenant context and include `tenant_id` in Prisma filters for all tenant-scoped models, including nested validation lookups.

No mechanic endpoint may trust `tenantId`, `employeeId`, `mechanicId`, or `bayId` supplied by the request body for scoping.

### 9. API Contract

Mechanic-facing APIs use restricted DTOs. Existing back-office DTOs must not be reused if they expose PII or financial fields.

Minimum endpoints:

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/mechanic/queue` | Current mechanic's active task queue. |
| `GET` | `/api/mechanic/tasks/:taskId` | Digital Repair Order task detail projection. |
| `POST` | `/api/mechanic/tasks/:taskId/start` | Punch in and create active `LaborEntry`. |
| `POST` | `/api/mechanic/tasks/:taskId/switch` | Composite state transition: close the current open `LaborEntry`, update the previous task status, and start a different task in one atomic operation. |
| `POST` | `/api/mechanic/tasks/:taskId/pause` | Punch out current interval with pause reason. |
| `POST` | `/api/mechanic/tasks/:taskId/complete` | Complete task and close active labor. |
| `PATCH` | `/api/mechanic/tasks/:taskId/diagnostics` | Debounced auto-save notes/checklist payload. |
| `POST` | `/api/mechanic/tasks/:taskId/parts` | Add part request as `PENDING_PICK`. |
| `POST` | `/api/mechanic/tasks/:taskId/media/uploads` | Create presigned POST upload policy/session. |
| `POST` | `/api/mechanic/tasks/:taskId/media` | Persist uploaded media metadata. |

Contract regeneration is mandatory for implementation:

1. Regenerate backend OpenAPI.
2. Regenerate frontend API types.
3. Use generated contracts for mechanic hooks.
4. Define `mechanicQueueKeys` and related mutation invalidation rules.

### 10. Real-Time Sync

Mechanic actions must update the Service Advisor view without refresh.

#### 10.1 Supported Entity Mapping

Implementation must add or verify real-time support for:

- `WORKSHOP_ORDER`
- `WORKSHOP_TASK`
- `LABOR_ENTRY`
- `WORKSHOP_TASK_LINE_ITEM`
- `WORKSHOP_MEDIA`

Backend changes must update the Prisma realtime supported entity list. Frontend changes must update the dashboard/entity-to-query-key map.

#### 10.2 Event Expectations

- Punch in updates task/order state to in progress.
- Pause updates task blocked state.
- `WAITING_CUSTOMER` publishes a notification domain event for Service Advisor outreach.
- Switch task emits two `WORKSHOP_TASK` updates in the same transaction: the previous task moves to `WAITING_PARTS`, `WAITING_CUSTOMER`, or `PAUSED`, and the new task moves to `IN_PROGRESS`.
- Part requisition updates parts department queues.
- Part staging updates mechanic tablet parts readiness.
- Media upload updates order evidence count.
- Complete task updates board status and may complete the parent order.

### 11. Touch-First UX Contract

The mechanic tablet UI follows the product owner's golden rules.

#### 11.1 Active Queue

- Use the shared DataTable pattern, but with tablet-appropriate density.
- Rows are large enough for gloved touch interaction.
- Sorting and filtering are supported, but the default view is prioritized current-day work.
- Row click opens the Digital Repair Order.
- No row-level delete/edit icon clutter.

#### 11.2 Digital Repair Order Header

Top-left context:

- Breadcrumbs, e.g. `Queue > Order #1024`.
- `StatusBadge`, e.g. `In Progress`.
- Vehicle identifier, e.g. `2019 BMW M3 - License: W-12345`.

Top-right action:

- One primary action at a time.
- Large touch target.
- Main active state action is **Complete Task** once work is in progress.

#### 11.3 Information Hierarchy

Primary mechanic sections:

1. Complaint / reported issue.
2. Assigned tasks.
3. Required parts and parts readiness.
4. Inspection/checklist.
5. Diagnostic notes.
6. Media evidence.

Hidden from mechanic UI:

- Customer billing card.
- Invoice totals.
- Labor rates.
- Part cost/margin details.
- Admin/settings navigation.

### 12. Deletion Policy and Data Governance

Implementation introduces new persisted entities and lifecycle rules. The deletion policy must be updated before code completion.

Required policy decisions:

| Entity | Deletion Rule |
|--------|---------------|
| `LaborEntry` | No hard delete after creation; corrections require adjustment/correction record or manager-only edit with audit trail. |
| `InspectionTemplate` | Cannot delete if used by any `WorkshopInspection`; can deactivate. |
| `InspectionTemplateItem` | Cannot delete if captured responses exist; can deactivate in future template versions. |
| `WorkshopInspection` | Cannot delete after order completion; manager-only void before completion. |
| `WorkshopInspectionItem` | Follows parent inspection; no standalone delete after completion. |
| `WorkshopMedia` | Cannot delete after order completion; before completion manager-only delete, mechanic may only remove failed/unattached uploads. |

### 13. Implementation Sequence

1. Finalize feature spec for mechanic tablet execution workflow.
2. Add schema migration for task assignment fields, `LaborEntry`, inspection entities, media entity, and part-line status.
3. Update database state machine documentation for `WAITING_CUSTOMER`.
4. Update deletion policy for new entities.
5. Implement mechanic RBAC guards and restricted DTO projections.
6. Implement the single-query mechanic queue projection and in-memory mapper with no secondary looping lookups.
7. Implement queue/detail/start/pause/complete/diagnostics/parts/media endpoints.
8. Implement the nightly `23:59` labor-entry close-out scheduler using `chunkedPromiseAll`.
9. Integrate `WAITING_CUSTOMER` transitions with the standard notification/event bus for Service Advisor email/SMS outreach.
10. Implement presigned POST media upload policy generation with content-length and MIME-type enforcement.
11. Regenerate OpenAPI and frontend generated API types.
12. Implement `mechanicQueueKeys`, mechanic hooks, and mutation invalidation.
13. Implement touch-first queue and Digital Repair Order UI.
14. Add realtime entity support and frontend cache mappings.
15. Add backend E2E tests for RBAC, tenant isolation, state transitions, labor entries, forced labor close-out, part requisitions, advisor notification emission, media upload policy constraints, and forbidden financial/PII fields.
16. Add frontend tests for queue visibility, top-right primary action placement, auto-save indicator, and hidden financial/PII UI.

## Consequences

### Positive

- Mechanics work directly at the bay without paper orders or shared-terminal trips.
- Service Advisors receive immediate status visibility through existing real-time infrastructure.
- Labor tracking becomes auditable and tied to task state transitions.
- Forced nightly close-out prevents unbounded weekend or overnight labor leakage.
- Parts requests flow cleanly into the existing Inventory/Parts staging workflow without allowing mechanics to mutate stock directly.
- Media evidence supports customer trust and upsell justification while keeping binaries out of PostgreSQL.
- Restricted backend projections enforce RBAC even if a frontend route is bypassed.

### Negative

- Adds several schema entities and state transitions, increasing migration and testing scope.
- Requires careful DTO design to avoid accidentally leaking financial or customer PII fields from existing Workshop Order aggregates.
- Requires additional realtime mapping work beyond current dashboard entity coverage.
- Tablet/offline behavior increases frontend complexity around auto-save, retry, and upload failure handling.
- Introduces scheduler ownership and notification-pipeline coupling that must be tested for idempotency and duplicate suppression.

### Neutral

- The mechanic tablet surface is intentionally separate from the back-office Workshop Order detail page.
- Task-level assignment coexists with order-level board assignment through deterministic inheritance rules.
- A full inspection-template builder is deferred; seeded templates are sufficient for Phase 1.
- Media sharing with customers is deferred to a future customer-approval/estimate workflow.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Reuse the existing Workshop Order detail page for mechanics | Fastest initial UI reuse. | Exposes too much back-office context, poor tablet ergonomics, high risk of PII/financial leakage. |
| Keep paper work orders and only add status buttons | Low implementation cost. | Fails the shop-floor digitization goal and does not capture diagnostics, checklist, parts requests, or evidence at source. |
| Let mechanics directly consume inventory | Fewer handoffs for small shops. | Violates separation of duties and risks bypassing ledger/kitting controls. Parts department loses pick/stage accountability. |
| Store media blobs in PostgreSQL | Simple transactional model. | Bloats database, slows backups/queries, and violates the cloud-storage media architecture. |
| Use only order-level assignment | Simpler board model. | Cannot handle multiple mechanics on one order or task-specific routing. |

## References

- [ADR-0001: Prisma `$extends` Real-Time Sync via WebSocket](2026-04-12-prisma-extends-realtime-sync.md)
- [ADR-0006: Form Auto-Save Patterns](2026-04-12-form-auto-save-patterns.md)
- [ADR-0012: Parts Kitting and Tote Staging End-to-End Workflow](2026-04-15-parts-kitting-and-tote-staging.md)
- [ADR-0013: Workshop Planner Kanban Board](2026-04-18-workshop-planner-kanban-board.md)
- [Row-Level Multi-Tenancy](2026-04-15-row-level-multi-tenancy.md) *(linked document title: ADR-0013; stable reference by filename/title)*
- [Database State Machines](../04-Database/state-machines.md)
- [Deletion Policy](../../deletion-policy.md)
- [Shared Promise Utilities](../../../apps/core-api/src/common/utils/promise.util.ts)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | Auto Core Platform |
| Milestone | TBD |
| Issues | TBD |
