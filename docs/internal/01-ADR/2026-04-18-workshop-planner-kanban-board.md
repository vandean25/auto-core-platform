---
title: "ADR-0013: Workshop Planner Kanban Board (Real-Time Drag & Drop)"
date: "2026-04-18"
status: proposed
deciders: "Product Owner, Architecture, Backend Lead, Frontend Lead"
linear-project: "Auto Core Platform"
linear-milestone: ""
tags:
  - adr
  - workshop
  - kanban
  - drag-and-drop
  - real-time
  - ux
  - api
---

# ADR-0013: Workshop Planner Kanban Board (Real-Time Drag & Drop)

## Status

**Proposed** — 2026-04-18

## Context

Service Advisors and Workshop Managers currently lack a visual, at-a-glance view of workshop capacity. The existing `WorkshopOrderList` is a DataTable — effective for searching and sorting, but inadequate for **spatial planning**. Managers cannot quickly see:

- Which orders are unassigned.
- Which mechanic is working on what.
- Whether the parts for an order are staged and ready, or still waiting.

This leads to mechanic idle time, missed handoffs, and constant manual radio/phone coordination to ask "what's next?"

The Kanban Board must provide:

1. **Swimlane columns** — one per mechanic (plus an "Unassigned" column) showing active `WorkshopOrder` cards.
2. **Drag-and-drop assignment** — dragging a card between columns assigns (or unassigns) an order to a mechanic/bay.
3. **Parts readiness badges** — each card shows a computed `partsStatus` (`READY`, `WAITING`, `SHORTAGE`) based on inventory in the order's staging tote.
4. **Real-time updates** — when another user assigns an order or parts arrive, the board refreshes automatically via WebSocket.
5. **Optimistic UI** — drag-and-drop applies instantly; the server confirms asynchronously.

### Prerequisite Gap: No Mechanic or Bay Entities

> [!CAUTION]
> The current schema has **no `Mechanic`, `Bay`, `Employee`, or `User` model**. The `WorkshopOrder` model has no `assigned_mechanic_id` or `bay_id` column. This feature **cannot be built** without first introducing these entities and the corresponding schema migration.

This ADR covers both the prerequisite schema additions and the board-specific architecture.

---

## Decision

### 1. Scope and Ownership

- **Primary module:** Workshop.
- **Cross-module dependencies:** Inventory (staging tote stock lookups), Dashboard/Realtime (WebSocket board refresh), Frontend Shared UI (StatusBadge, Sheet).
- **New third-party dependency:** `@dnd-kit/core` (drag-and-drop library for React).
- **Does NOT introduce:** new state machine statuses, new inventory transaction types, or new deletion policy entities (Employee/Bay are master data — deletion rules documented below).
- **Superseded by:** [Feature Spec: Workshop Board Resources](../02-Feature-Specs/Workshop/workshop-board-resources.md) for entity design decisions (sections 2.1–2.3 below amended on 2026-04-18).

### 2. Data Model and Schema Changes

#### 2.1 New Entity: `Employee` (Amended 2026-04-18)

> [!NOTE]
> **Originally proposed as a standalone `Mechanic` entity.** Amended per approved [Feature Spec: Workshop Board Resources](../02-Feature-Specs/Workshop/workshop-board-resources.md) to use a general-purpose `Employee` model with an `EmployeeRole` enum.

A general-purpose scheduling resource entity:

```prisma
enum EmployeeRole {
  MECHANIC
  SERVICE_ADVISOR
  PARTS_CLERK
}

model Employee {
  id         String       @id @default(uuid())
  name       String
  role       EmployeeRole
  is_active  Boolean      @default(true)
  sort_order Int          @default(0)

  workshop_orders WorkshopOrder[]

  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  @@map("employees")
}
```

**Design rationale:**

- **Not a User/Auth entity.** No password, email, or login capability. This is a scheduling resource. A future `user_id` FK can link to an auth system without breaking this model.
- **`EmployeeRole` enum** — avoids duplicate tables when other roles are needed (Service Advisor, Parts Clerk). The board endpoint filters `WHERE role = 'MECHANIC' AND is_active = true`.
- **`is_active` flag.** Soft-disable instead of delete. Inactive employees are hidden from the board's column list but preserved for historical order references.
- **`sort_order`.** Controls column order on the Kanban board. Avoids alphabetical-only sorting.
- **All three roles (`MECHANIC`, `SERVICE_ADVISOR`, `PARTS_CLERK`)** are seeded from day one to build a foundation.

#### 2.2 New Entity: `Bay` (Amended 2026-04-18 — Promoted to First-Class)

> [!NOTE]
> **Originally deferred to Phase 2** as free-text `bay_label`. Promoted to a first-class entity per Product Owner ruling to ensure FK integrity and enumerable board columns.

```prisma
model Bay {
  id         String   @id @default(uuid())
  name       String   @unique
  is_active  Boolean  @default(true)
  sort_order Int      @default(0)

  workshop_orders WorkshopOrder[]

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@map("bays")
}
```

**Design rationale:**

- `name` is unique — prevents duplicate bay entries.
- No `capacity` or `vehicle_type` constraints in this phase. Bay is purely a column label for the board.
- **Bay ↔ Mechanic cardinality is M:N** — any mechanic can work in any bay. There is no join table or direct FK between `Employee` and `Bay`. The Kanban board acts as the source of truth for current assignment via `WorkshopOrder.mechanic_id` + `WorkshopOrder.bay_id`.

#### 2.3 WorkshopOrder Schema Additions (Amended 2026-04-18)

```prisma
model WorkshopOrder {
  // ... existing fields ...

  mechanic_id  String?
  mechanic     Employee?  @relation(fields: [mechanic_id], references: [id], onDelete: SetNull, onUpdate: Cascade)

  bay_id       String?
  bay          Bay?       @relation(fields: [bay_id], references: [id], onDelete: SetNull, onUpdate: Cascade)

  @@index([mechanic_id], map: "idx_workshop_orders_mechanic_id")
  @@index([bay_id], map: "idx_workshop_orders_bay_id")
}
```

- Both FKs are nullable — unassigned orders appear in the "Unassigned" column.
- `onDelete: SetNull` — if an employee or bay record is deleted, the order becomes unassigned rather than cascading.
- `mechanic_id` and `bay_id` are **independent** — an order can be assigned to a mechanic, a bay, both, or neither.

#### 2.4 Migration

- **Type:** Additive, non-breaking.
- **New tables:** `employees`, `bays`.
- **New enum:** `EmployeeRole` (`MECHANIC`, `SERVICE_ADVISOR`, `PARTS_CLERK`).
- **New columns on `workshop_orders`:** `mechanic_id` (nullable FK → Employee), `bay_id` (nullable FK → Bay).
- **New indexes:** `idx_workshop_orders_mechanic_id`, `idx_workshop_orders_bay_id`.
- Existing orders remain valid with `mechanic_id = NULL` and `bay_id = NULL`.

### 3. API Contract

#### 3.1 Board Active Endpoint

- **Method:** `GET`
- **Route:** `/api/workshop/board/active`

**Response shape:**

```typescript
interface BoardActiveResponse {
  columns: BoardColumn[];
  unassigned: BoardCard[];
}

interface BoardColumn {
  mechanicId: string;
  mechanicName: string;
  sortOrder: number;
  cards: BoardCard[];
}

interface BoardCard {
  orderId: string;
  orderNumber: string;
  status: WorkshopOrderStatus;
  customer: { id: string; displayName: string };
  vehicle: { id: string; make: string; model: string; year: number; plate?: string };
  bayLabel?: string;
  partsStatus: 'READY' | 'WAITING' | 'SHORTAGE' | 'NO_PARTS';
  taskSummary: { total: number; done: number };
  createdAt: string;
}
```

**Backend computation strategy (N+1 prevention — mandatory):**

The `partsStatus` per card is the most expensive computation. It must follow the "Pre-fetch & Map" pattern from ADR-0002:

1. **Single query:** Fetch all active `WorkshopOrder` records (status in `INTAKE`, `IN_PROGRESS`, `SCHEDULED`) with `include: { tasks: { include: { line_items: true } }, assignedMechanic: true, customer: true, vehicle: true }`.
2. **Extract all part SKUs:** Iterate the in-memory result set once to collect every `WorkshopTaskLineItem` where `type === 'PART'`, building a `Map<catalogItemId, requiredQuantity>` per order.
3. **Single query:** For all orders that have a `staging_location_id`, fetch `InventoryStock` records `WHERE location_id IN (stagingLocationIds) AND catalog_item_id IN (allPartItemIds)` in one query.
4. **In-memory map:** Build a `Map<locationId, Map<catalogItemId, quantityOnHand>>` from the stock results.
5. **Compute `partsStatus`:** For each order, compare required quantities against staged quantities:
   - `NO_PARTS` — order has zero part line items.
   - `READY` — every part line item's required quantity ≤ staged quantity.
   - `SHORTAGE` — at least one part has 0 staged quantity.
   - `WAITING` — all parts have some staged quantity, but at least one is below required.

**Total queries:** Exactly 2 (orders + inventory stock). Zero loops containing await calls.

#### 3.2 Board Assign Endpoint

- **Method:** `PATCH`
- **Route:** `/api/workshop/board/assign`

**Request payload:**

```typescript
interface BoardAssignPayload {
  orderId: string;            // Required
  mechanicId?: string | null; // FK → Employee (role: MECHANIC), null = unassign
  bayId?: string | null;      // FK → Bay, null = unassign
}
```

**Backend behavior:**

1. Validate `orderId` exists and is in an active status (`SCHEDULED`, `INTAKE`, `IN_PROGRESS`). Return `422` if not.
2. If `mechanicId` is provided, validate the employee exists, `role === MECHANIC`, and `is_active = true`. Return `404` if not.
3. If `bayId` is provided, validate the bay exists and `is_active = true`. Return `404` if not.
4. Update `WorkshopOrder.mechanic_id` and `WorkshopOrder.bay_id`.
5. No transaction wrapper needed — this is a single-row update with no side effects.
6. The global `Prisma $extends` hook (ADR-0001) automatically broadcasts `WORKSHOP_ORDER:UPDATED` via WebSocket.

**Response:** Updated `WorkshopOrder` (full entity with includes).

**Error contract:**

| HTTP Status | Condition |
|-------------|-----------|
| `400` | Malformed payload (missing `orderId`, invalid UUID format) |
| `404` | Order or mechanic not found |
| `422` | Order is in a terminal status (`COMPLETED`, `INVOICED`) — assignment not allowed |

> [!NOTE]
> **No atomic guard needed for assignment.** Unlike status transitions, mechanic assignment is a last-write-wins operation. Two concurrent assignments to the same order result in the last one winning — this is acceptable for scheduling (the board will reflect the final state via WebSocket). No `updateMany` guard or `409 Conflict` is required.

#### 3.3 Employee & Bay CRUD Endpoints (Master Data)

**Employee endpoints** (in a new `EmployeeModule`):

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/employees` | List all employees (filter by `?role=MECHANIC&includeInactive=true`) |
| `POST` | `/api/employees` | Create a new employee |
| `PATCH` | `/api/employees/:id` | Update name, role, `is_active`, `sort_order` |
| `DELETE` | `/api/employees/:id` | Soft-disable preferred. Hard delete blocked if referenced by any `WorkshopOrder`. |

**Bay endpoints** (in a new `BayModule`):

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/bays` | List all bays (filter by `?includeInactive=true`) |
| `POST` | `/api/bays` | Create a new bay |
| `PATCH` | `/api/bays/:id` | Update name, `is_active`, `sort_order` |
| `DELETE` | `/api/bays/:id` | Soft-disable preferred. Hard delete blocked if referenced by any `WorkshopOrder`. |

Both are simple CRUD with no state machine or transactional complexity. Management UI lives as tabs in the existing `SettingsPage.tsx`.

#### 3.4 Contract Regeneration Checklist

Any backend DTO or route change must regenerate and commit:

1. `npm --prefix apps/core-api run openapi:generate`
2. `npm --prefix apps/core-web run api:types:generate`
3. Commit both generated files.

### 4. Real-Time Sync

The board **requires** real-time sync. When Mechanic A's board shows an order, and Mechanic B (or the service advisor) reassigns it, Mechanic A's board must update without a manual refresh.

**Existing infrastructure is sufficient:**

- `WorkshopOrder` is already in `SUPPORTED_ENTITY_TYPES` (ADR-0001).
- The `$extends` hook already emits `WORKSHOP_ORDER:UPDATED` on any `WorkshopOrder.update()`.
- The assign endpoint fires a normal Prisma `update`, so WebSocket emission is automatic.

**Required frontend changes:**

- Add `boardActive` to the `workshopKeys` factory.
- In `dashboard-entity-map.ts`, extend the `WORKSHOP_ORDER` entry to also invalidate `['workshop', 'board-active']` so the board query refetches when any order mutates.

### 5. Frontend Architecture

#### 5.1 Query Key Factory Extension

```typescript
export const workshopKeys = {
  // ... existing keys ...
  boardActive: () => [...workshopKeys.all, 'board-active'] as const,
}
```

#### 5.2 Page Component: `WorkshopBoard.tsx`

- **Route:** `/workshop/board` (new navigation entry under Workshop domain).
- **Header:** Standard layout — title "Workshop Planner" top-left, `+ Workshop Order` button top-right.
- **Filter bar:** Optional filters for `partsStatus`, `orderStatus` (client-side filter on the board data).

#### 5.3 Drag-and-Drop: `@dnd-kit/core`

**Library choice rationale:**

| Library | Verdict |
|---------|---------|
| `@dnd-kit/core` (chosen) | Modern React-first library, supports keyboard accessibility, composable sensors, active maintenance. Lightweight (~12KB gzip). |
| `react-beautiful-dnd` | Deprecated by Atlassian. No React 19 support. |
| `react-dnd` | Lower-level API, requires more boilerplate. HTML5 backend has mobile issues. |
| Native HTML drag-and-drop | No accessibility, poor mobile support, verbose event handling. |

**Implementation pattern:**

- `<DndContext>` wraps the board.
- Each swimlane column is a `<Droppable>` container.
- Each card is a `<Draggable>` item.
- `onDragEnd` fires the assign mutation.

#### 5.4 Optimistic Update Pattern

The drag-and-drop must feel instant. Use TanStack Query's mutation lifecycle:

```typescript
useMutation({
  mutationFn: assignOrderToMechanic,
  onMutate: async ({ orderId, mechanicId }) => {
    // Cancel in-flight board queries
    await queryClient.cancelQueries({ queryKey: workshopKeys.boardActive() });
    // Snapshot previous board state
    const previous = queryClient.getQueryData(workshopKeys.boardActive());
    // Optimistically move the card to the new column
    queryClient.setQueryData(workshopKeys.boardActive(), (old) =>
      moveCardInBoard(old, orderId, mechanicId)
    );
    return { previous };
  },
  onError: (_err, _vars, context) => {
    // Rollback on failure
    queryClient.setQueryData(workshopKeys.boardActive(), context?.previous);
    toast.error('Failed to assign order. Reverting.');
  },
  onSettled: () => {
    // Always refetch to sync with server truth
    queryClient.invalidateQueries({ queryKey: workshopKeys.boardActive() });
  },
});
```

#### 5.5 Card Component: `WorkshopOrderCard.tsx`

Dense, scannable card layout:

| Row | Content |
|-----|---------|
| **Top** | Order number (bold) + `StatusBadge` for order status |
| **Middle** | Vehicle: `{year} {make} {model}` — Plate: `{plate}` |
| **Bottom-left** | Customer display name |
| **Bottom-right** | `partsStatus` badge: `READY` (green), `WAITING` (amber), `SHORTAGE` (red), `NO_PARTS` (gray) |
| **Subtle** | Task progress: e.g., "2/4 tasks done" |

**Interaction:**
- Click → opens existing `WorkshopOrderDetails` in a shadcn/ui `Sheet` (right drawer).
- Right-click → context menu with "Unassign" action.

#### 5.6 StatusBadge Extension

Add `partsStatus` values to the shared `statusClassMap` in `StatusBadge.tsx`:

| Status | Color | Label |
|--------|-------|-------|
| `READY` | Green (`bg-emerald-100 text-emerald-800`) | Parts Ready |
| `WAITING` | Amber (`bg-amber-100 text-amber-800`) | Waiting Parts |
| `SHORTAGE` | Red (`bg-red-100 text-red-800`) | Parts Shortage |
| `NO_PARTS` | Gray (`bg-slate-100 text-slate-600`) | No Parts |

### 6. Deletion Policy

| Entity | Rule | Rationale |
|--------|------|-----------|
| `Employee` | **Soft-disable preferred.** Hard delete blocked if `WorkshopOrder.mechanic_id` references this employee. | Preserve historical assignment data. Inactive employees are hidden from the board but remain linked to past orders. |
| `Bay` | **Soft-disable preferred.** Hard delete blocked if `WorkshopOrder.bay_id` references this bay. | Preserve historical assignment data. Inactive bays are hidden from the board. |

> `docs/deletion-policy.md` must be updated to add `Employee` and `Bay` entity rows.

### 7. UX Compliance Checklist

- [x] Page-level actions (`+ Workshop Order`, filters) → **top-right header**.
- [x] Top-left → reserved for page title "Workshop Planner".
- [x] Status rendering → uses shared `StatusBadge` component. New `partsStatus` values added to `statusClassMap`.
- [x] Card click opens detail → existing `WorkshopOrderDetails` in `Sheet`.
- [x] Create button format → `+ Workshop Order`.

### 8. Inventory Interaction

This feature **reads** inventory but does **not write** it. Parts status is computed from `InventoryStock.quantity_on_hand` at the staging tote location. No ledger entries are created by the board endpoints.

**Invariant preserved:** No direct mutation of `InventoryStock`. Read-only access.

### 9. Fiscal Impact

None. The board and assign endpoints do not create financial records, do not interact with invoices, and do not need fiscal lock date validation.

### 10. Implementation Sequence (Normative)

1. **Schema migration:** Create `Employee` model (with `EmployeeRole` enum) + `Bay` model + add `mechanic_id` and `bay_id` columns to `WorkshopOrder`.
2. **Backend Employee & Bay CRUD:** Simple REST endpoints in `EmployeeModule` and `BayModule`.
3. **Backend board endpoints:** `GET /board/active` (with Pre-fetch & Map partsStatus computation) + `GET /board/resources` (concurrent `Promise.all`) + `PATCH /board/assign`.
4. **OpenAPI + frontend type regeneration.**
5. **Frontend query key extension:** Add `boardActive` and `boardResources` to `workshopKeys`.
6. **Frontend entity map update:** Extend `WORKSHOP_ORDER` mapping to invalidate board-active cache.
7. **Frontend `WorkshopBoard.tsx`:** Swimlane layout with `@dnd-kit/core` (pointer + touch sensors), view mode toggle with `localStorage` persistence, board filter persistence to `localStorage`, empty state card.
8. **Frontend `WorkshopOrderCard.tsx`:** Dense card with status and partsStatus badges.
9. **Optimistic mutation hook:** Drag-and-drop with rollback.
10. **StatusBadge extension:** Add partsStatus values.
11. **Settings UI:** Add Employee and Bay management tabs in `SettingsPage.tsx`.
12. **End-to-end verification.**

---

## Consequences

### Positive

- **Visual planning** replaces manual coordination. Service advisors can see the entire workshop state at a glance.
- **Instant feedback** via optimistic updates makes drag-and-drop feel native-app responsive.
- **Zero new N+1 queries.** The Pre-fetch & Map pattern limits the board endpoint to exactly 2 database queries regardless of order count.
- **Reuses existing real-time infrastructure.** No new WebSocket namespace, no new event types — `WORKSHOP_ORDER:UPDATED` already flows through the existing `$extends` pipeline.
- **Schema migration is additive and non-breaking.** Existing workshop orders continue to work with `assigned_mechanic_id = NULL`.

### Negative

- **Two new entities (`Employee`, `Bay`) must be managed.** Adds master-data maintenance surface (Employee and Bay tabs in Settings).
- **`@dnd-kit/core` is a new frontend dependency.** Adds ~12KB gzip to the bundle. Must be evaluated against React 19 compatibility at implementation time.
- **Board endpoint returns all active orders.** For very large workshops (50+ simultaneous orders), this could become a performance concern. Pagination/virtualization is deferred to Phase 2.

### Neutral

- The `Employee` entity is decoupled from any future `User`/auth model. If RBAC is introduced later, a `user_id` FK can be added to `Employee` without migrating existing data.
- Assignment is last-write-wins (no atomic guard). This is a deliberate simplification — scheduling conflicts are visible and self-correcting on the Kanban board.
- Bay ↔ Mechanic cardinality is M:N at the application level — no join table or direct FK constraint between them.

---

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Kanban with `@dnd-kit/core` (chosen)** | Modern, accessible, React 19 compatible, lightweight, composable | New dependency to maintain |
| **Kanban with `react-beautiful-dnd`** | Well-documented, many examples | Deprecated by Atlassian, no React 19 support, unmaintained |
| **Table-based assignment (no board)** | No new dependency, reuses DataTable | Poor visual planning UX, doesn't solve the spatial awareness problem |
| **Standalone `Mechanic` entity** | Self-documenting naming, narrower scope | Cannot reuse for other roles (Service Advisor, Parts Clerk); requires separate migration later |
| **Server-side computed board via SQL views** | Pushes computation to the database, potentially faster | Harder to maintain, couples UI layout to SQL, makes partsStatus computation opaque, violates separation of concerns |

---

## Resolved Questions (Product Owner Rulings — 2026-04-18)

All architectural questions have been resolved. See [Feature Spec: Workshop Board Resources](../02-Feature-Specs/Workshop/workshop-board-resources.md) for full rulings.

1. ✅ **Entity strategy:** `Employee` with `EmployeeRole` enum replaces standalone `Mechanic`. `Bay` promoted to first-class entity. (Sections 2.1–2.3 amended above.)
2. ✅ **Settings location:** Employee and Bay management tabs centralized in `SettingsPage.tsx`.
3. ✅ **View mode persistence:** Default to `mechanic` view. Persist selection to `localStorage`.
4. ✅ **Empty state:** Actionable shadcn/ui `Card` with "Go to Settings" button when no resources configured.
5. ✅ **Bay ↔ Mechanic cardinality:** Strictly M:N — independent FKs on `WorkshopOrder`, no join table.

### Phase 1 UX Rulings (2026-04-18)

6. ✅ **Touch-optimized gestures:** Include in Phase 1. Service Advisors use iPads on the shop floor — desktop-only is a non-starter. Wire up `@dnd-kit/core`'s `TouchSensor` alongside `PointerSensor` from day one using `useSensors(useSensor(PointerSensor), useSensor(TouchSensor))`.
7. ✅ **Capacity limits:** Advisory only — no hard constraints. Managers may temporarily overload a top-tier mechanic for a rush job. A visual warning (e.g., column header turns amber) can be added in a follow-up phase, but never block assignment.
8. ✅ **Board filter persistence:** Yes. Status and partsStatus filters persist to `localStorage` (key: `workshop-board-filters`) alongside the view mode. Advisor preferences must survive page refreshes.

**All questions are now resolved. No open items remain.**

---

## References

- [ADR-0001: Prisma $extends Real-Time Sync](2026-04-12-prisma-extends-realtime-sync.md) — WebSocket auto-emission for `WorkshopOrder` mutations
- [ADR-0002: Ledger-Based Inventory](2026-04-12-ledger-based-inventory.md) — read-only inventory access for partsStatus; Pre-fetch & Map pattern
- [ADR-0011: Atomic Status Transition Guards](2026-04-12-atomic-status-transition-guards.md) — assignment intentionally skips atomic guard (last-write-wins)
- [ADR-0012: Parts Kitting and Tote Staging](2026-04-15-parts-kitting-and-tote-staging.md) — staging tote concept and `staging_location_id` on WorkshopOrder
- [Feature Spec: Workshop Order Lifecycle](../02-Feature-Specs/Workshop/workshop-order-lifecycle.md) — existing state machines and task sub-statuses
- [@dnd-kit documentation](https://docs.dndkit.com/) — drag-and-drop library
- `apps/core-web/src/api/workshop.ts` — existing `workshopKeys` factory
- `apps/core-web/src/features/realtime/dashboard-entity-map.ts` — entity-to-cache-key mapping

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | Auto Core Platform |
| Milestone | Workshop Planner Kanban Board |
| Issues | To be linked at implementation kickoff |
