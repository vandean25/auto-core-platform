---
title: "Workshop Board Resources (Mechanics & Bays)"
date: "2026-04-18"
module: "Workshop"
status: approved
linear-project: "Auto Core Platform"
linear-milestone: "Workshop Planner Kanban Board"
tags:
  - feature-spec
  - workshop
  - kanban
  - master-data
---

# Workshop Board Resources (Mechanics & Bays)

## Summary

> The Workshop Board requires structured resource data — **Mechanics** (human resources) and **Bays** (physical work stations) — to populate Kanban swimlane columns. This feature introduces the schema entities, the unified `GET /api/workshop/resources` endpoint, the frontend query/state layer, and the view-mode toggle that lets the board switch between mechanic-centric and bay-centric layouts. It is a prerequisite for the drag-and-drop assignment flow described in [ADR-0018](../../01-ADR/2026-04-18-workshop-planner-kanban-board.md).

---

## Architectural Decision: Entity Strategy (Resolved)

> [!NOTE]
> **ADR-0018 Superseded (Sections 2.1–2.3)**
>
> ADR-0018 originally proposed a standalone `Mechanic` model with `Bay` deferred to Phase 2 as free-text `bay_label`. This spec was approved by the Product Owner on 2026-04-18 with a different approach:
> - An `Employee` model with an `EmployeeRole` enum (`MECHANIC`, `SERVICE_ADVISOR`, `PARTS_CLERK`).
> - A first-class `Bay` entity with FK integrity from day one.
> - **ADR-0018 sections 2.1, 2.2, and 2.3 have been amended** to reflect this decision.

### Resolved Tradeoff Analysis

| Dimension | ADR-0018 (Superseded) | This Spec (Approved) |
|-----------|----------------------|----------------------|
| **Schema scope** | Narrower — one purpose-built `Mechanic` table | Wider — general-purpose `Employee` table usable by future features (timesheets, RBAC, payroll) |
| **Naming** | `Mechanic` is self-documenting but exclusive | `Employee` requires a `role` filter but avoids duplicate tables when other roles are needed |
| **Bay integrity** | Free-text `bay_label` — no FK, inconsistent data risk | First-class `Bay` entity — FK-protected, enumerable for board columns |
| **Migration cost** | Slightly lower (one table) | Slightly higher (two tables + enum) |
| **Future flexibility** | Requires a second migration if `Employee` or `Bay` is added later | Ready for role expansion and bay capacity planning |

**Decision:** `Employee` + `Bay` approach adopted. The marginal extra migration cost is worth the data integrity and extensibility.

---

## User Stories

- As a **Service Advisor**, I want to **see all active mechanics as Kanban columns** so that **I can drag orders to assign them to the right person**.
- As a **Service Advisor**, I want to **switch to a bay-centric view** so that **I can plan work by physical workspace instead of by person**.
- As a **Workshop Manager**, I want to **manage the list of mechanics and bays** so that **the board always reflects current shop capacity**.

---

## Database Impact

### New Tables

#### `Employee`

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | `String @id @default(uuid())` | No | UUID | Primary key |
| `name` | `String` | No | — | Display name |
| `role` | `EmployeeRole` | No | — | Enum: `MECHANIC`, `SERVICE_ADVISOR`, `PARTS_CLERK` |
| `is_active` | `Boolean` | No | `true` | Soft-disable for board visibility |
| `sort_order` | `Int` | No | `0` | Controls column order on the Kanban board |
| `createdAt` | `DateTime` | No | `now()` | — |
| `updatedAt` | `DateTime` | No | `@updatedAt` | — |

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

**Design notes:**
- **Not an auth/user entity.** No password, email, or login capability. This is a scheduling resource. A future `user_id` FK can link to an auth system without breaking this model.
- `EmployeeRole` is an enum, not a boolean flag. This avoids adding `is_mechanic`, `is_advisor`, etc. columns and scales to new roles without schema changes.
- The board endpoint filters `WHERE role = 'MECHANIC' AND is_active = true`.

#### `Bay`

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | `String @id @default(uuid())` | No | UUID | Primary key |
| `name` | `String @unique` | No | — | Display label (e.g., "Bay 1", "Alignment Pit") |
| `is_active` | `Boolean` | No | `true` | Soft-disable for board visibility |
| `sort_order` | `Int` | No | `0` | Controls column order when in bay view mode |
| `createdAt` | `DateTime` | No | `now()` | — |
| `updatedAt` | `DateTime` | No | `@updatedAt` | — |

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

**Design notes:**
- `name` is unique — prevents duplicate bay entries (fixing the free-text `bay_label` problem from ADR-0018).
- No `capacity` or `vehicle_type` constraints in this phase. Bay is purely a column label for the board.

### Modified Tables

| Table | Change | Migration Required? |
|-------|--------|---------------------|
| `WorkshopOrder` | Add nullable FK `mechanic_id → Employee` | Yes — additive, non-breaking |
| `WorkshopOrder` | Add nullable FK `bay_id → Bay` | Yes — additive, non-breaking |

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

- Both FKs are nullable — existing orders remain valid with `NULL`.
- `onDelete: SetNull` — deleting a mechanic/bay unassigns orders rather than cascading.

### Deletion Policy Impact

> Two new entities must be added to `docs/deletion-policy.md`.

| Entity | Delete Allowed | Rule |
|--------|---------------|------|
| `Employee` | Soft-disable preferred | Set `is_active = false`. Hard delete blocked if any `WorkshopOrder.mechanic_id` references this employee. Inactive employees are hidden from the board but preserved for historical order references. |
| `Bay` | Soft-disable preferred | Set `is_active = false`. Hard delete blocked if any `WorkshopOrder.bay_id` references this bay. |

---

## API Contract Changes

### New Endpoints

#### `GET /api/workshop/resources`

Fetches all active board resources in a single call. The backend executes two concurrent database queries via `Promise.all()` to minimize latency.

| Method | Route | Request Body | Response | Auth |
|--------|-------|-------------|----------|------|
| `GET` | `/api/workshop/resources` | — (query param: `?includeInactive=true` for Settings UI) | `BoardResourcesResponse` | — |

**Backend implementation (mandatory `Promise.all` pattern):**

```typescript
async getBoardResources(includeInactive = false): Promise<BoardResourcesResponse> {
  const activeFilter = includeInactive ? {} : { is_active: true };

  const [mechanics, bays] = await Promise.all([
    this.prisma.client.employee.findMany({
      where: { role: 'MECHANIC', ...activeFilter },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    }),
    this.prisma.client.bay.findMany({
      where: activeFilter,
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    }),
  ]);

  return { mechanics, bays };
}
```

**Response shape:**

```typescript
interface BoardResourcesResponse {
  mechanics: BoardResource[];
  bays: BoardResource[];
}

interface BoardResource {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}
```

**Total queries:** Exactly 2, executed concurrently. Zero N+1 risk.

**Error contract:**

| HTTP Status | Condition |
|-------------|-----------|
| `200` | Always — returns empty arrays if no resources exist |

#### Employee CRUD Endpoints

| Method | Route | Request Body | Response | Auth |
|--------|-------|-------------|----------|------|
| `GET` | `/api/employees` | — (`?role=MECHANIC&includeInactive=true`) | `{ data: Employee[] }` | — |
| `POST` | `/api/employees` | `{ name, role, sortOrder? }` | `Employee` | — |
| `PATCH` | `/api/employees/:id` | `{ name?, role?, isActive?, sortOrder? }` | `Employee` | — |
| `DELETE` | `/api/employees/:id` | — | `204` or `409` if referenced | — |

#### Bay CRUD Endpoints

| Method | Route | Request Body | Response | Auth |
|--------|-------|-------------|----------|------|
| `GET` | `/api/bays` | — (`?includeInactive=true`) | `{ data: Bay[] }` | — |
| `POST` | `/api/bays` | `{ name, sortOrder? }` | `Bay` | — |
| `PATCH` | `/api/bays/:id` | `{ name?, isActive?, sortOrder? }` | `Bay` | — |
| `DELETE` | `/api/bays/:id` | — | `204` or `409` if referenced | — |

### Modified Endpoints

| Method | Route | Change Description |
|--------|-------|-------------------|
| `PATCH` | `/api/workshop/board/assign` | Payload changes from `{ mechanicId?, bayLabel? }` (ADR-0018) to `{ mechanicId?, bayId? }` — proper FK instead of free-text |

Updated assign payload:

```typescript
interface BoardAssignPayload {
  orderId: string;
  mechanicId?: string | null;  // FK → Employee (role: MECHANIC)
  bayId?: string | null;        // FK → Bay
}
```

Backend validation additions:
- If `mechanicId` provided: validate Employee exists, `role === MECHANIC`, `is_active === true`. Return `404` otherwise.
- If `bayId` provided: validate Bay exists, `is_active === true`. Return `404` otherwise.

### OpenAPI Regeneration

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

### Layout & Actions

- [x] Page-level actions (`+ Workshop Order`, view mode toggle, filters) are **top-right aligned**.
- [x] Top-left reserved for page title "Workshop Planner" only.
- [x] Uses `text-2xl font-semibold tracking-tight` for page header.
- [x] Subtitle uses `text-slate-500`.

### View Mode Toggle (New UX Element)

A shadcn/ui `ToggleGroup` in the **top-right header** area (alongside the `+ Workshop Order` button) controls the board column source:

```
[ 🔧 By Mechanic ] [ 🏗️ By Bay ]
```

| Mode | Columns Generated From | Column Header |
|------|----------------------|---------------|
| `mechanic` (default) | `resources.mechanics` array | Mechanic name |
| `bay` | `resources.bays` array | Bay name |

- **Default:** `mechanic` view — human capacity is usually the primary workshop constraint.
- **Persistence:** The selected view mode is persisted to `localStorage` (`workshop-board-view-mode`) so that the Service Advisor's muscle memory is preserved across page refreshes and browser sessions.
- The toggle is a **client-side state** initialized from `localStorage` (fallback: `'mechanic'`). It does not trigger a new API call — both arrays are already in the cached `boardResources` response.
- The "Unassigned" column is always present regardless of view mode. It shows orders where `mechanic_id IS NULL` (mechanic mode) or `bay_id IS NULL` (bay mode).
- Switching modes re-renders columns instantly (no loading state).

### Empty State (Required)

When `boardResources` returns an empty `mechanics` array (in mechanic mode) or empty `bays` array (in bay mode), the board **must not** render as a blank page.

**Required behavior:** Render a centered shadcn/ui `Card` with:
- **Icon:** `Wrench` (lucide-react) or `LayoutGrid` depending on view mode.
- **Heading:** "No mechanics configured" / "No bays configured".
- **Description:** "The Workshop Planner needs at least one active resource to display columns."
- **Action button:** `Go to Settings` — routes to `SettingsPage.tsx` with the Employees or Bays tab pre-selected.

The "Unassigned" column is **still rendered** alongside the empty state card so that any existing unassigned orders remain visible.

### List Pages (if applicable)

Not directly applicable — this feature surfaces resources as Kanban columns, not as a list page. However, the Settings management UI for Employees/Bays should follow list standards:

- [x] Create button format: `+ Employee` / `+ Bay`.
- [x] Sortable column headers via `DataTable` / `DataTableColumnHeader`.
- [x] Row click opens inline edit.
- [x] Right-click row → contextual Delete (if no references exist).

### Form Handling

- [x] Employee/Bay creation modals use standard form submit (not auto-save — these are short forms).
- [x] Inline edits to name/sort order in Settings use **save-on-blur** via `InlineEdit`.

### Real-Time Sync

- [ ] **Employee** — Evaluate adding to `SUPPORTED_ENTITY_TYPES`. **Recommendation: defer.** Employee changes are rare master-data edits, not high-frequency mutations. A full page reload after adding a mechanic in Settings is acceptable for Phase 1.
- [ ] **Bay** — Same as Employee. Defer real-time sync.
- [x] **WorkshopOrder** — Already in `SUPPORTED_ENTITY_TYPES`. Assignment changes (`mechanic_id`, `bay_id`) automatically broadcast via `$extends` hook.

> [!NOTE]
> The board does need to refetch `boardResources` if a mechanic/bay is added/deactivated during the session. For Phase 1, this is handled by **navigating back to the board from Settings**, which remounts the page and triggers a fresh query. If real-time resource sync becomes a user pain point, Employee/Bay can be added to `SUPPORTED_ENTITY_TYPES` in a follow-up.

---

## Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `WorkshopBoard.tsx` | `src/pages/workshop/` | Main board page — consumes both `boardActive` and `boardResources` queries to render columns |
| `BoardViewToggle.tsx` | `src/components/workshop/` | shadcn/ui `ToggleGroup` wrapper for `mechanic` / `bay` mode switch |
| `EmployeeSettingsTab` | `src/pages/SettingsPage.tsx` (tab) | DataTable for managing employees (filter by role) |
| `BaySettingsTab` | `src/pages/SettingsPage.tsx` (tab) | DataTable for managing bays |

### Frontend Query Key Factory

Add `boardResources` to the existing `workshopKeys` factory:

```typescript
export const workshopKeys = {
  // ... existing keys ...
  boardActive: () => [...workshopKeys.all, 'board-active'] as const,
  boardResources: () => [...workshopKeys.all, 'board-resources'] as const,
}
```

### Frontend Hook

```typescript
export function useWorkshopBoardResources() {
  return useQuery<BoardResourcesResponse>({
    queryKey: workshopKeys.boardResources(),
    queryFn: async () => {
      const response = await fetchWithAuth('/api/workshop/resources');
      if (!response.ok) throw new Error('Failed to fetch board resources');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 min — resources change infrequently
  });
}
```

### Column Generation Logic (in `WorkshopBoard.tsx`)

```typescript
const STORAGE_KEY = 'workshop-board-view-mode';

function getInitialViewMode(): 'mechanic' | 'bay' {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'bay' ? 'bay' : 'mechanic';
}

const [viewMode, setViewMode] = useState<'mechanic' | 'bay'>(getInitialViewMode);

// Persist to localStorage on change
useEffect(() => {
  localStorage.setItem(STORAGE_KEY, viewMode);
}, [viewMode]);

const { data: resources } = useWorkshopBoardResources();
const { data: boardData } = useWorkshopBoardActive();

const columns = useMemo(() => {
  const sourceArray = viewMode === 'mechanic'
    ? resources?.mechanics ?? []
    : resources?.bays ?? [];
  return sourceArray.map(resource => ({
    id: resource.id,
    title: resource.name,
  }));
}, [viewMode, resources]);

// Empty state detection
const hasResources = columns.length > 0;
```

---

## State Machine Impact

None. This feature does not introduce new statuses or modify existing state transitions. Mechanic/bay assignment is an **orthogonal property** on `WorkshopOrder`, not a state machine edge.

---

## Inventory Impact

None. This feature does not read or write inventory data. Parts status computation is handled by the `GET /api/workshop/board/active` endpoint (ADR-0018), not the resources endpoint.

---

## Fiscal Impact

None. Employee and Bay are master-data entities with no financial implications. No interaction with `FinanceSettings`, invoices, or lock dates.

---

## Testing Plan

### Backend E2E

- [ ] `GET /api/workshop/resources` returns `{ mechanics: [], bays: [] }` when no records exist.
- [ ] `GET /api/workshop/resources` returns only active employees with `role = MECHANIC` and active bays.
- [ ] `GET /api/workshop/resources?includeInactive=true` returns all employees and bays.
- [ ] Employee CRUD: create, update name/role/sortOrder, deactivate, delete (blocked when referenced by WorkshopOrder).
- [ ] Bay CRUD: create, update name/sortOrder, deactivate, delete (blocked when referenced by WorkshopOrder, reject duplicate name).
- [ ] `PATCH /api/workshop/board/assign` with `bayId` — validates bay exists and is active.
- [ ] `PATCH /api/workshop/board/assign` with `mechanicId` — validates employee exists, `role === MECHANIC`, `is_active === true`.
- [ ] Assigning a non-MECHANIC employee role returns `422`.
- [ ] `Promise.all` concurrency: verify resources endpoint executes both queries in parallel (test via query timing, not via mocking).

### Frontend

- [ ] Board renders mechanic columns from resources when `viewMode === 'mechanic'`.
- [ ] Board renders bay columns from resources when `viewMode === 'bay'`.
- [ ] Toggle switch re-renders columns without a loading spinner.
- [ ] "Unassigned" column is always visible in both modes.
- [ ] View mode persists across page refreshes via `localStorage`.
- [ ] Default view mode is `mechanic` when no `localStorage` value exists.
- [ ] Empty state: when no mechanics exist, a centered Card with "Go to Settings" button is rendered.
- [ ] Empty state: when no bays exist (in bay mode), equivalent Card is rendered.
- [ ] Empty state: "Unassigned" column still renders alongside the empty state card.
- [ ] Settings: Employee tab shows CRUD DataTable with role filter.
- [ ] Settings: Bay tab shows CRUD DataTable with unique name validation.
- [ ] Deactivating a mechanic removes their column from the board on next visit.
- [ ] Drag-and-drop works on touch devices (iPad) via `TouchSensor`.
- [ ] Board filters (status, partsStatus) persist across page refreshes via `localStorage`.
- [ ] Board filters initialize from `localStorage` on mount, defaulting to "show all" when no stored value exists.

---

## Resolved Decisions (Product Owner Rulings — 2026-04-18)

All open questions have been resolved. These rulings are **binding** for implementation.

### 1. Employee Scope: Seed All Roles Immediately

**Ruling:** Add `MECHANIC`, `SERVICE_ADVISOR`, and `PARTS_CLERK` to the `EmployeeRole` enum from day one. We are building a foundation, not a stopgap.

**Constraint:** The `GET /api/workshop/resources` endpoint **must** strictly filter `WHERE role = 'MECHANIC' AND is_active = true` when populating the board. Service Advisors and Parts Clerks must never appear as draggable Kanban columns.

### 2. Bay ↔ Mechanic Cardinality: Strictly M:N

**Ruling:** Any mechanic can work in any bay. There is no `Bay ↔ Employee` join table or direct FK. Real workshops are highly dynamic — a mechanic starts in Bay 1 for an oil change and moves to the Alignment Rack after lunch.

**Implementation consequence:** The Kanban board is the source of truth for current assignment. `WorkshopOrder.mechanic_id` and `WorkshopOrder.bay_id` are independent nullable FKs with no cross-validation between them. An order can be assigned to Mechanic A and Bay 3 — or just one of the two.

### 3. Settings Location: Centralized in SettingsPage.tsx

**Ruling:** Employees and Bays are global master data. Their CRUD tabs go in the existing `SettingsPage.tsx` using shadcn/ui `Tabs`, alongside Brands, Storage Locations, and Revenue Groups. No fragmented management pages.

### 4. Default View & Persistence: Mechanic + localStorage

**Ruling:** Default to `mechanic` view — human capacity is the primary workshop constraint. The selected view mode **must** be persisted to `localStorage` (key: `workshop-board-view-mode`) so that the Service Advisor's muscle memory is not broken on every page refresh.

### 5. Empty State: Actionable Setup Prompt

**Ruling:** Never leave the user staring at a blank screen. When the resource query returns an empty array for the current view mode, render a centered shadcn/ui `Card` explaining that the board requires resources, with a button routing directly to the Settings page (pre-selecting the relevant tab). The "Unassigned" column still renders alongside the empty state card.

### 6. Touch-Optimized Gesture Support: Phase 1 Required

**Ruling:** Include touch sensors in Phase 1. Service Advisors frequently walk the shop floor with iPads — desktop-only is a non-starter. Wire up `@dnd-kit/core`'s `TouchSensor` alongside `PointerSensor` from day one.

**Implementation:** Use `useSensors(useSensor(PointerSensor), useSensor(TouchSensor))` and pass to `<DndContext sensors={sensors}>`. This is a single-line configuration change in `@dnd-kit/core` — no additional dependencies required.

### 7. Capacity Limits: Advisory Only

**Ruling:** No hard constraints on the number of orders assigned to a single mechanic. In a real workshop, a manager may temporarily overload a top-tier mechanic to get a rush job done. Hard-blocking this in the UI would break operational flow.

**Future consideration:** A visual warning (e.g., column header turns amber when a mechanic has >N orders) can be added in a follow-up phase, but assignment must never be blocked.

### 8. Board Filter Persistence: localStorage

**Ruling:** Status and partsStatus filters must persist to `localStorage` (key: `workshop-board-filters`), just like the view mode. If an advisor prefers to only see "Parts Ready" orders, that preference must survive page refreshes.

**Implementation:** Store the active filter state as a serialized JSON object. Read on mount, write on change via `useEffect`.

---

## References

- [ADR-0018: Workshop Planner Kanban Board](../../01-ADR/2026-04-18-workshop-planner-kanban-board.md) — parent ADR for the board feature (sections 2.1–2.3 require amendment if this spec is approved)
- [ADR-0001: Prisma $extends Real-Time Sync](../../01-ADR/2026-04-12-prisma-extends-realtime-sync.md) — WebSocket auto-emission (deferred for Employee/Bay)
- [ADR-0005: Deletion Policy Enforcement](../../01-ADR/2026-04-12-deletion-policy-enforcement.md) — Employee and Bay deletion rules must be added
- [Feature Spec: Workshop Order Lifecycle](workshop-order-lifecycle.md) — WorkshopOrder model context
- [Deletion Policy](../../../deletion-policy.md) — must be updated with Employee and Bay rows
- `apps/core-web/src/api/workshop.ts` — existing `workshopKeys` factory to extend
- `apps/core-web/src/pages/SettingsPage.tsx` — target for Employee/Bay management tabs

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | Auto Core Platform |
| Milestone | Workshop Planner Kanban Board |
| Issues | To be linked at implementation kickoff |
