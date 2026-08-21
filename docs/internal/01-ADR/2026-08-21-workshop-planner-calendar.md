---
title: "ADR-0019: Workshop Planner Calendar (Time + Bay Occupancy)"
date: "2026-08-21"
status: proposed
deciders: "Product Owner, Architecture, Backend Lead, Frontend Lead"
linear-project: "Workshop Planner Calendar"
linear-milestone: ""
tags:
  - adr
  - workshop
  - planner
  - calendar
  - scheduling
  - service-advisor
---

# ADR-0019: Workshop Planner Calendar (Time + Bay Occupancy)

## Status

**Proposed** — 2026-08-21

## Context

The Service Advisor already has three workshop doors:

| Surface | Route | Job |
|---------|-------|-----|
| Intake | `/workshop/intake` | Car is here. Search VIN/plate, start service. |
| Orders | `/workshop/orders` | Run the job: tasks, parts, checkout. |
| Board | `/workshop/board` | Who owns the stall *right now*. Kanban, no clock. |

`WorkshopOrderStatus.SCHEDULED` is documented as **future appointment** ([Feature Spec: Workshop Order Lifecycle](../02-Feature-Specs/Workshop/workshop-order-lifecycle.md)), but create always writes `INTAKE`, there is no start/end timestamp on the order, and `Bay` has no hours. `WorkshopTask.scheduled_date` is a **date-only** field for the mechanic tablet queue (ADR-0014), not an advisor booking clock.

[ADR-0018](2026-04-18-workshop-planner-kanban-board.md) solved *spatial* assignment (mechanic/bay columns). It explicitly deferred capacity: assignment is never blocked; overload is advisory. That ruling is correct for the floor. It is **wrong** for a booking calendar: a bay cannot hold two cars in the same minute.

The next module is a Service Advisor **planner**:

1. Define when this tenant's workshop is open (hours + slot size + holidays).
2. See which bay is free at a given time.
3. Create a workshop order in that free spot.

Without a separate time surface, advisors will keep booking in a list, double-book bays, and create a second order at the door when the car arrives.

## Decision

### 1. Scope and ownership

- **Primary module:** Workshop.
- **New frontend surface:** `/workshop/planner` — sidebar label **Workshop Planner**.
- **Existing board stays** `/workshop/board` — sidebar label **Workshop Board**. Do not merge the calendar into the kanban.
- **Does not introduce:** a separate `Appointment` entity, pre-generated slot rows, customer self-booking, recurring *job* series, or labor-AW duration engine.
- **Does introduce:** tenant-owned **holidays** (closed days and short days) as an override of weekday hours, plus an on-demand **OpenHolidays API** import that copies nationwide public holidays into those rows. Planner reads never call the vendor.
- **Cross-module dependencies:** CRM (customer + vehicle search already used by intake), Dashboard/Realtime (`WORKSHOP_ORDER` already broadcasts), Settings (new hours tab).

### 2. Occupancy is the workshop order

A booking **is** a `WorkshopOrder` in `SCHEDULED` (or later active) status with:

- `scheduled_start_at` / `scheduled_end_at` (`DateTime`, timestamptz)
- `bay_id` (already exists)

Free space is the inverse of those intervals against tenant opening hours. No `Appointment` table and no `WorkshopSlot` rows.

**Why not a separate Appointment?** `SCHEDULED` already means future work. A second entity needs conversion, numbering, and two UIs for one job. Intake must promote the booked order, not mint a sibling.

**Why not generated slots?** A row per bay × day × 30-minute cell explodes, needs regeneration when hours change, and makes a 90-minute job span N rows. Occupancy queries on `[start, end)` are enough.

### 3. Hours are tenant settings, not FinanceSettings

New singleton `WorkshopSettings` + child `WorkshopOpeningHour` rows (one per weekday) + `WorkshopHoliday` rows (tenant-owned closed or short days). Do **not** hang operational hours off `FinanceSettings`. Fiscal lock date and invoice prefixes are a different concern.

Defaults for a new workshop tenant:

- Timezone `Europe/Vienna`
- Slot size `30` minutes
- Mon–Fri `07:30–17:00`
- Saturday `08:00–12:00`
- Sunday closed
- Holidays: **empty until import or manual add**. Default import country `AT`. No hardcoded AT/DE table in our repo.

**Public-holiday import — OpenHolidays, not Nager.Date.**

| | OpenHolidays | Nager.Date |
|---|--------------|------------|
| AT 2026 nationwide public days | 13, German names (`Nationalfeiertag`) | 20 if unfiltered (Sundays + regional school/patron days); v4 English-only |
| Auth / cost | None, ODbL, commercial OK | Community API, no key |
| Localization | `languageIsoCode=DE` | v3 `localName`; v4 `name` is English |
| Fit | DACH open data, OpenAPI, hosted in DE | Better if we needed 200 countries |

Import is `POST /api/workshop/holidays/import`: server fetches `GET https://openholidaysapi.org/PublicHolidays`, keeps `type=Public` nationwide (plus optional subdivision), copies into `WorkshopHoliday` with `source=IMPORTED` and `repeats_annually=false`. Timeout 3s → 502. Easter Monday is a dated row for that year; re-import next year. Manual Betriebsurlaub is never overwritten.

**Effective hours for a local date:** matching holiday wins (closed all day, or holiday `open_time`/`close_time`). Else the weekday row. Annual holidays match month+day every year; 29 Feb is skipped in non-leap years.

The planner grid is derived from these settings. Advisors may still book outside hours, on Sunday, or on a holiday (rush job); the UI warns, the API does not 422. The grid must still *look* closed or shortened so a stall does not appear free. This matches ADR-0018's "never block operational flow" for *hours*, while still hard-blocking *bay collisions* (section 5).

### 4. Create path for scheduled work

`POST /api/workshop/orders` today always creates `INTAKE` and requires `odometer` + `fuelLevel`. The car is not here yet.

Planner create:

- `status = SCHEDULED`
- requires `customerId` (for `CUSTOMER_REPAIR`), `vehicleId`, `bayId`, `scheduledStartAt`, `scheduledEndAt`
- `odometer` / `fuelLevel` optional; persist `0` until intake captures the real values (columns stay `Int`, not nullable)
- default duration **60 minutes** when the advisor only picks a start cell
- optional `mechanicId` (active `MECHANIC`); not required to hold the bay

Walk-in intake is unchanged: omit schedule fields → `INTAKE` as today.

### 5. Bay overlap is a hard conflict; mechanic overlap is advisory

| Resource | Same-time overlap | Rationale |
|----------|-------------------|-----------|
| **Bay** | HTTP `409` | Physical stall. Two cars do not fit. |
| **Mechanic** | Allowed; amber warning on the planner | Same ruling as ADR-0018 §7. A lead tech can be double-booked for a rush. |
| **Opening hours / holidays** | Allowed; amber warning | After-hours, Sunday, or holiday overflow is a real shop move. |

Overlap set: orders in `SCHEDULED`, `INTAKE`, `IN_PROGRESS` with non-null `bay_id`.

- **Timed:** both schedule timestamps set → occupy `[scheduled_start_at, scheduled_end_at)`.
- **Unscheduled on-floor:** `INTAKE` or `IN_PROGRESS` with a bay and null timestamps → occupy that bay for **today in the tenant timezone** using effective hours (holiday override included). If today is fully closed, occupy local midnight→next midnight. Walk-ins must not make a stall look empty on the planner.

`COMPLETED` / `INVOICED` do not occupy the bay.

Phase 1 enforces this inside `prisma.$transaction` with a range overlap query. A Postgres `EXCLUDE USING gist` constraint is a follow-up if concurrent double-book races show up; it is not required to ship.

### 6. Intake must consume the booking

When the advisor hits **Start Service** (or `+ Order`) for a vehicle that already has a `SCHEDULED` order:

1. If exactly one open `SCHEDULED` order exists for that vehicle, **promote** it: `SCHEDULED → INTAKE`, capture odometer/fuel/issue. Do not allocate a new `WO-` number.
2. If several exist, pick the one whose `scheduled_start_at` is closest to now, and show which order was claimed in the toast.
3. If none exist, create `INTAKE` as today.

This is the load-bearing integration. Without it the planner creates orphans and the door creates duplicates.

Mechanic-queue `WorkshopTask.scheduled_date` stays date-only. When the first tasks are added to a scheduled order, default `scheduled_date` to the calendar date of `scheduled_start_at` in the tenant timezone. Do not invent task-level start/end in Phase 1.

### 7. Real-time, deletion, fiscal, inventory

- **Deletion:** `SCHEDULED` orders may be deleted (no-show / cancelled booking). Aligns with current deletion-policy language for pre-work states. No new `CANCELLED` status in Phase 1. `WorkshopHoliday` may be hard-deleted; it is not referenced by orders.
- **Realtime:** reuse `WORKSHOP_ORDER` WebSocket events. Add planner query keys to `dashboard-entity-map.ts`. `WorkshopSettings`, opening hours, and holidays are rare; refetch on navigating back from Settings (same as Employee/Bay in the board spec).
- **Fiscal:** none. Booking does not create invoices or touch `lock_date`.
- **Inventory:** none. Planner does not read or write stock.

## Consequences

### Positive

- Advisors get a clock and a free-stall picture without replacing the board.
- One document number from booking through invoice.
- Hours are first-class tenant setup for a new workshop, including holidays.
- Bay integrity is enforced where physics requires it.

### Negative

- `WorkshopOrder` gains scheduling columns that walk-in jobs may leave null (allowed).
- Two workshop planning UIs (board vs calendar) must stay conceptually separate in nav and docs.
- Application-level overlap checks can theoretically race; acceptable until proven otherwise.

### Neutral

- Sidebar grows by one item under Workshop.
- `SCHEDULED` cards already appear on the board; Phase 1 does not hide them. A date badge on the card can wait.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **A. Occupancy on `WorkshopOrder` (chosen)** | Reuses `SCHEDULED`, one job card, YAGNI | Walk-in orders have null times |
| **B. Separate `Appointment` → convert at intake** | Clean CRM booking without dummy odometer | Two lifecycles, conversion bugs, numbering |
| **C. Generated `WorkshopSlot` rows** | Trivial "is this cell free?" | Slot explosion, regen on hour changes, multi-slot jobs |
| **D. Stretch the kanban with a time axis** | One page | Board is "who has the car now"; mixing clocks destroys scanability |
| **E. Nager.Date as import source** | 200+ countries, no key | v4 English names; AT feed includes school/Sunday rows we would have to filter. Worse DACH fit. |
| **F. Hardcoded AT/DE table in-repo** | No vendor | Stale when laws change; wrong for non-AT tenants. |

## References

- [ADR-0018: Workshop Planner Kanban Board](2026-04-18-workshop-planner-kanban-board.md)
- [ADR-0014: Mechanic Digital Repair Order Tablet RBAC](2026-04-27-mechanic-digital-repair-order-tablet-rbac.md) — `scheduled_date` is queue date, not booking time
- [ADR-0013: Row-Level Multi-Tenancy](2026-04-15-row-level-multi-tenancy.md)
- [Feature Spec: Workshop Planner Calendar](../02-Feature-Specs/Workshop/2026-08-21-workshop-planner-calendar.md)
- [OpenHolidays API](https://www.openholidaysapi.org/en/) — chosen public-holiday import
- [Nager.Date](https://date.nager.at/api) — considered and rejected
- [Feature Spec: Workshop Board Resources](../02-Feature-Specs/Workshop/workshop-board-resources.md)
- [Feature Spec: Workshop Order Lifecycle](../02-Feature-Specs/Workshop/workshop-order-lifecycle.md)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Workshop Planner Calendar](https://linear.app/auto-core-platform/project/workshop-planner-calendar-9da198210de2) |
| Milestone | Spec review |
| Issues | [AUT-173](https://linear.app/auto-core-platform/issue/AUT-173) |
