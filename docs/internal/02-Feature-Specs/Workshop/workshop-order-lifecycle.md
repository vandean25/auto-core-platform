---
title: "Workshop Order Lifecycle & Job Cards"
date: "2026-04-12"
module: "Workshop"
status: approved
linear-project: "3f6b9a20628c"
linear-milestone: "N/A"
tags:
  - feature-spec
  - workshop
  - pdf
---

# Workshop Order Lifecycle & Job Cards

## Summary

> The Workshop module manages the intake, repair sequence, labor allocation, and completion of vehicle servicing. It unifies customer CRM data, vehicle data, inventory parts, and standardized labor operations into a cohesive "Workshop Order". Orders with `purpose = STOCK_PREP` (ADR-0016) run on dealer-owned stock cars: they **must not** create a customer invoice; costs post to `VehicleLedgerEntry` as `WORKSHOP_COST`. This module also includes asynchronous, background PDF generation for printing professional Job Cards for mechanics and customer receipts.

---

## User Stories

- As a **Service Advisor**, I want to **intake a vehicle** so that **I can record the customer's reported issue, fuel level, and odometer reading.**
- As a **Mechanic**, I want to **receive a printed PDF Job Card** so that **I know exactly which tasks and labor operations I need to perform on the vehicle.**
- As a **Mechanic**, I want to **dictate diagnostic notes in my preferred spoken language** so that **the system can translate them into the workshop note language without forcing me to type on a tablet.**
- As a **Service Manager**, I want to **track the status of each task** so that **I can accurately bill the customer and convert the completed order into a final Sales Invoice.**

---

## Database Impact

### Core Tables

| Table | Purpose | Key Constraints / Notes |
|-------|---------|-------------------------|
| `WorkshopOrder` | Master document for a workshop visit | Links to `Customer` (required for `CUSTOMER_REPAIR`; optional for `STOCK_PREP` — ADR-0016) and `Vehicle`. Tracks `status`, `purpose`, `odometer`, `fuel_level` and generated PDF. |
| `WorkshopTask` | A specific job within the order (e.g., "Replace Brakes") | Belongs to `WorkshopOrder`. Has its own sub-status (`NOT_STARTED` -> `DONE`). |
| `WorkshopTaskLineItem`| Parts or Labor consumed by the task | Represents either a `PART` (SKU referenced) or `LABOR` (code referenced). Tracks `quantity` and `unit_price`. |

### Deletion Policy Impact

> Governed by `docs/deletion-policy.md`.
- `WorkshopOrder`: **Conditional (future API)**. Prefer cancel/archive flow. If a delete endpoint is added, limit to pre-work intake states only (`SCHEDULED` or `INTAKE`). Blocked once `IN_PROGRESS` or later, or if an `Invoice` has been generated. Deleting cascades to `WorkshopTask` and their `WorkshopTaskLineItem` children.
- `WorkshopTask`: **Conditional**. Allow only when parent `WorkshopOrder` is not `INVOICED` and no linked invoice exists yet on the order. Cascades to `WorkshopTaskLineItem`.

---

## State Machine & Transitions

The module uses two interacting state machines:

### Workshop Order Status (`WorkshopOrderStatus`)
1. **`SCHEDULED`**: Future appointment.
2. **`INTAKE`**: Vehicle is physically present; keys are taken.
3. **`IN_PROGRESS`**: Work has begun on at least one task.
4. **`COMPLETED`**: All tasks are `DONE`. Vehicle is ready for pickup.
5. **`INVOICED`**: A final `Invoice` has been generated. The order is now locked.

### Workshop Task Status (`WorkshopTaskStatus`)
1. **`NOT_STARTED`**: Default state.
2. **`IN_PROGRESS`**: Mechanic is actively working on it.
3. **`WAITING_PARTS`**: Work halted due to missing inventory.
4. **`DONE`**: Task is complete.

*Invariant:* A `WorkshopOrder` cannot transition to `COMPLETED` unless all its `WorkshopTask` children are `DONE`.

### Inventory Integration (Parts Consumption)

When a `WorkshopTaskLineItem` of type `PART` is consumed, the backend must create an `InventoryTransaction` with type `WORKSHOP_CONSUMPTION` (negative quantity) through `ledger.service.ts`. This follows the same ledger pattern as sales — developers must never directly decrement `InventoryStock.quantity_on_hand`.

### Invoice Generation (COMPLETED → INVOICED)

When a `WorkshopOrder` transitions from `COMPLETED` → `INVOICED`:

1. An `Invoice` entity is created with `InvoiceItem` lines snapshotting both **parts** (from `WorkshopTaskLineItem` of type `PART`) and **labor** (from `WorkshopTaskLineItem` of type `LABOR`, sourced from `LaborOperation`).
2. Snapshotted fields follow ADR-0004: `unit_price`, `item_name`/`description`, and `revenue_group_name`.
3. The invoice is assigned a sequential number from `InvoiceSequence` and validated against the fiscal lock date (ADR-0003).
4. All of the above executes within a single `prisma.$transaction`.

---

## UX Compliance

### Layout & Actions
- [x] Page-level actions (`Print Job Card`, `Checkout / Invoice`) are **top-right aligned** inside an `<ActionGroup>`.
- [x] Top-left reserved for Order Number, Vehicle Plate, and Breadcrumbs.

### List Pages
- [x] Create button format: `+ Workshop Order`.
- [x] Status cells use shared `StatusBadge` component (`statusClassMap`).
- [x] Row click opens the Order Detail view.

### Form Handling
- [x] Modifying the `WorkshopOrder` header uses **debounced auto-save (750 ms)**.
- [x] Single-field task updates (e.g., Mechanic Notes) use **save-on-blur** via `InlineEdit`.
- [ ] Mechanic tablet diagnostic notes support AI-assisted voice-note drafts. Recordings are captured with `MediaRecorder`, uploaded to the backend as `multipart/form-data`, translated server-side, reviewed/edited by the mechanic, and then saved through the standard diagnostics mutation path.

### Component Design

| Component | Location | Purpose |
|-----------|----------|---------|
| `WorkshopOrderList` | `src/pages/workshop/` | DataTable view of all active orders. |
| `WorkshopOrderDetails`| `src/pages/workshop/` | Main document view. Auto-saves changes. |
| `TaskDetailDrawer` | `src/components/workshop/`| Sliding drawer exposing labor, parts line items, typed notes, and AI-assisted voice-note drafts for a task. |
| `ActionGroup` | `src/components/ui/` | Top-right dropdown grouping secondary actions (like Print PDF). |

---

## API Contract Changes (Retroactive Sync)

### PDF Generation Pipeline
- **Method:** `POST`
- **Route:** `/api/workshop/:id/pdf/generate`
- **Behavior:** Kicks off an asynchronous background job via `CloudTasks` / `Playwright` (ADR-0007). The frontend relies on Real-Time Sync (WebSocket `entity_updated` event) to detect when `pdf_storage_key` is populated and replace the spinner with a "Download PDF" button.

### Mechanic AI Voice Notes
- **Method:** `POST`
- **Route:** `/api/mechanic/tasks/:taskId/voice-notes`
- **Request:** `multipart/form-data` audio file captured after recording stops.
- **Behavior:** Validates tenant, mechanic assignment, MIME type, byte size, duration, and task state; sends the audio to `VoiceTranslationModule`; returns a translated diagnostic-note draft; does not persist the draft until the mechanic accepts it through the diagnostics save flow.
- **Guardrails:** No client-side AI models, no phase-one raw audio WebSocket streaming, no provider credentials in the browser, transient raw-audio retention by default, no transcript/audio content in normal logs, per-mechanic or per-tenant rate limiting.

### OpenAPI Regeneration
- [x] Contract already generated and committed for the existing PDF pipeline.
- [ ] Regenerate contract artifacts when the mechanic voice-note endpoint is implemented:
  - `npm --prefix apps/core-api run openapi:generate`
  - `npm --prefix apps/core-web run api:types:generate`

---

## Real-Time Sync

- [x] `WorkshopOrder` mutations emit socket events.
- [x] `dashboard-entity-map.ts` maps `WorkshopOrder` to invalidate `workshopOrderKeys.detail(id)`.

---

## Testing Plan

### Backend E2E

- [ ] Happy-path: Create WorkshopOrder → Add Tasks → Progress through statuses → Invoice → verify snapshot and ledger entry.
- [ ] Parts consumption creates `WORKSHOP_CONSUMPTION` InventoryTransaction.
- [ ] Cannot transition to `COMPLETED` if any task is not `DONE`.
- [ ] Fiscal lock date validation on `COMPLETED → INVOICED` transition.
- [ ] PDF generation pipeline triggers on `INVOICED` transition.
- [ ] Mechanic voice-note endpoint rejects unassigned tasks, wrong tenant, disallowed MIME types, oversized files, too-long recordings, and silent/empty recordings.
- [ ] Mechanic voice-note endpoint returns a translated draft without persisting diagnostic notes until the diagnostics save mutation accepts it.
- [ ] AI provider failures surface as endpoint errors without changing existing task notes.

### Frontend

- [ ] Visual QA: status badge rendering, task drawer, auto-save indicator.
- [ ] PDF spinner → download button transition via WebSocket.
- [ ] Voice-note UI shows recording, processing, draft-ready, accepted, and error states while preserving typed note edits.
- [ ] Translated drafts remain editable before being accepted into diagnostic notes.

---

## Open Questions

1. Should the workshop support partial invoicing (invoice some tasks while others remain in progress)?
2. Is a formal "cancel workshop order" workflow needed, or is deletion at intake sufficient?

---

## References

- ADR-0002: Ledger-Based Inventory — `WORKSHOP_CONSUMPTION` transaction type for parts
- ADR-0003: Fiscal Lock Date — invoice date validated on `COMPLETED → INVOICED`
- ADR-0004: Invoice Snapshotting — workshop invoice snapshots parts + labor fields
- ADR-0005: Deletion Policy — workshop entity deletion rules
- ADR-0006: Form Auto-Save — debounced auto-save for order header, save-on-blur for tasks
- ADR-0007: Async PDF Pipeline — Job Card generation via Playwright/Cloud Tasks
- ADR-0009: Sequential Document Numbering — `WO-2026-XXXX` assigned at creation/intake; invoice `RE-2026-XXXX` at `COMPLETED → INVOICED`
- ADR-0011: Atomic Status Transition Guards — all Workshop Order and Task status transitions use the `updateMany` guard pattern
- ADR-0014: Mechanic Digital Repair Order Tablet RBAC — mechanic tablet execution, restricted projections, and AI voice-note guardrails
- ADR-0019: Workshop Planner Calendar — `SCHEDULED` as a real booking with bay + time window; intake promotes the booking instead of creating a second order. See [Workshop Planner Calendar](2026-08-21-workshop-planner-calendar.md).

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Labor Master & Labor Data](https://linear.app/auto-core-platform/project/labor-master-and-labor-data-3f6b9a20628c) |
| Milestone | Existing Implementation |
| Issues | Backfilled Spec |
