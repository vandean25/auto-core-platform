---
title: "ADR-0020: HR Time and Leave (Attendance ≠ Labor, Leave ≠ Shop Holiday)"
date: "2026-08-22"
status: proposed
deciders: "Product Owner, Architecture, Backend Lead, Frontend Lead"
linear-project: "HR Time and Leave"
linear-milestone: "Spec review"
tags:
  - adr
  - hr
  - attendance
  - leave
  - employee
---

# ADR-0020: HR Time and Leave (Attendance ≠ Labor, Leave ≠ Shop Holiday)

## Status

**Proposed** — 2026-08-22

## Context

ACP now has three time-related ideas that look similar and must stay distinct:

| Concept | Owner | Question |
|---------|-------|----------|
| Shop hours + `WorkshopHoliday` | Workshop / ADR-0019 | Is the **workshop** open this day? |
| Board assignment + `LaborEntry` | Workshop / ADR-0018 + ADR-0014 | Who is on **this job**, and for how long? |
| Person attendance + Urlaub | **Missing** | Is this **human** at work, on pause, at the doctor, home, or on holiday — and how many days remain? |

[Feature Spec: Workshop Board Resources](../02-Feature-Specs/Workshop/workshop-board-resources.md) already chose a general-purpose `Employee` table "usable by future features (timesheets, RBAC, payroll)". Settings → Employees is the roster. `TenantMember` is the login (`OWNER` / `ADMIN` / `TECH` / `SALES`).

If we store employee leave as `WorkshopHoliday`, the planner grid closes for the whole shop when one mechanic is on holiday. If we store "came to work" as `LaborEntry`, we invent a dummy workshop task and pollute billable job time with Arzt and Pause.

The product request is an **HR module**: add employees, punch Come / Pause / Doctor / Go home, track remaining holidays, book holidays.

## Decision Drivers

* Keep workshop occupancy (bays) separate from people occupancy (leave).
* Keep job timers (`LaborEntry`) as an audit of work on a task.
* Reuse `Employee` — do not grow a parallel `HrPerson` table.
* Phase 1 must ship without payroll, approval workflows, or a PIN kiosk.
* Tenant isolation, OpenAPI contract, and deletion policy stay non-negotiable.
* YAGNI: smallest model that answers "are they here?" and "how many days left?"

## Decision

### 1. Module and ownership

- **Primary module:** HR (`apps/core-api/src/hr/`, frontend `/hr/*`).
- **Person record:** existing `Employee`. Add `hired_on` and `annual_leave_days` only.
- **Login record:** existing `TenantMember`. Self-service requires `Employee.user_id`.
- **Does not introduce:** a second person table, `Appointment` for leave, payroll, Krankenstand days, leave approval states, door kiosk.
- **Does not reuse:** `LaborEntry`, `LaborPauseReason`, `WorkshopHoliday` rows for employee Urlaub.

### 2. Attendance is an event log

`AttendanceEvent` is append-only: `CLOCK_IN`, `PAUSE`, `DOCTOR`, `CLOCK_OUT`, with `source` `SELF` | `MANAGER` | `AUTO_SHIFT_CLOSE`.

Current state is derived from the latest event by `occurred_at`. Illegal transitions return `409`. Nightly close inserts `CLOCK_OUT` / `AUTO_SHIFT_CLOSE` at local day end (tenant timezone from `WorkshopSettings`, default `Europe/Vienna`).

**Why not `LaborEntry`?** That row requires `workshop_task_id` and drives task status (`WAITING_PARTS`, etc.). HR pause is not a job pause.

**Why events instead of open interval rows?** Four punch types are a state machine on a person, not a start/end pair per job. A log is enough to rebuild the day. Manager corrections are extra events, never updates (same immutability spirit as `LaborEntry`).

Clock-in does **not** start a workshop task. Starting a task does **not** require being clocked in (Phase 1). Floor flow stays unblocked (ADR-0018 / ADR-0019 operational bias).

### 3. Leave is a date-range request, not a shop holiday

`LeaveRequest` (`start_on`, `end_on`, `status` `BOOKED` | `CANCELLED`, snapshotted `days_charged`).

`EmployeeLeaveBalance` per `(employee, year)` holds `allowance_days` and `carryover_days`. Remaining is computed:

```
allowance_days + carryover_days − SUM(days_charged WHERE status = BOOKED AND year matches)
```

Chargeable days skip closed weekdays and closed `WorkshopHoliday` dates (ADR-0019 effective hours). Public holidays therefore do not consume Urlaub. Short shop days still count as one leave day. Half-days deferred.

Phase 1 has **no approval workflow**. Booking writes `BOOKED` immediately if remaining and overlap checks pass.

**Why not `WorkshopHoliday`?** That entity overrides **bay** opening hours for every advisor. One mechanic on holiday must not empty the planner grid.

### 4. Planner integration is advisory

`GET /api/workshop/planner` gains `employeesAway[]` for BOOKED leave overlapping the window. The UI warns (amber). Bay overlap remains the only hard `409` (ADR-0019). Mechanic-on-leave is the same class of warning as mechanic double-book.

### 5. API split

- Keep `/api/employees` for roster CRUD (board, Settings, HR table). Add HR fields there — do not create `/api/hr/employees` as a second CRUD.
- Clock and leave live under `/api/hr` and `@MechanicAccessible()` only on `/api/hr/me/*`.
- Workday math lives in `HrWorkdayService` that **reads** workshop hours/holidays. Do not call OpenHolidays from HR. Do not grow `workshop-planner.service.ts` with leave booking.

### 6. Real-time, deletion, fiscal, inventory

- **Realtime:** opt-in `ATTENDANCE_EVENT` and `LEAVE_REQUEST`. Leave also invalidates planner query keys.
- **Deletion:** attendance never hard-deleted; leave is cancelled; employee hard-delete blocked when HR rows exist.
- **Fiscal / inventory:** none.

## Consequences

### Positive

- One person identity from board → tablet → HR.
- Shop holidays and employee holidays cannot corrupt each other.
- Job time and presence time stay independently auditable.
- Remaining leave is deterministic from allowance, carryover, and BOOKED snapshots.

### Negative

- Two "holiday" words in the product (shop holiday vs employee holiday). Docs and UI labels must say **Public / shop holiday** vs **Leave**.
- Two punch systems on the mechanic tablet (job start/pause vs HR clock). Labels must stay distinct.
- Application-level overlap checks for leave can theoretically race; same acceptance as planner bay overlap until proven otherwise.

### Neutral

- Sidebar grows by one **HR** item.
- Settings → Employees remains; it is not a second roster.

## Implementation Strategy

### Blast Radius

**Impact Scope:** New tables and `/api/hr`. Employee DTO additive fields. Planner GET additive `employeesAway`. Mechanic queue header gains a punch bar. Existing `LaborEntry` and `WorkshopHoliday` behavior unchanged.

**Affected Components:**

- `Employee` schema / Settings table — extra columns
- Workshop planner GET — extra array, warning UI
- Mechanic queue — extra controls, not task state
- Tenant cleanup / restore SQL — new tables

**User Impact:** Advisors see a new HR section. Mechanics see four extra buttons. Mis-tapping Pause on HR vs Pause on a job is the main UX risk — different copy: **Pause** (HR) vs existing job pause reasons.

**Risk Mitigation:**

- Spec forbids mixing models; e2e asserts `LaborEntry` is untouched by HR punches
- TECH locked to `/me` via existing `@MechanicAccessible()` guard
- Snapshot `days_charged` so hours edits do not rewrite history

### Reversibility

**Reversibility Level:** Medium. Additive schema. Dropping HR tables is a migration if unused; once punches exist they are audit data.

**Rollback Feasibility:** Hide `/hr` routes and mechanic punch bar. Leave `employeesAway` unused. Do not delete punch rows.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **A. Stretch `LaborEntry` + `WorkshopHoliday` (rejected)** | No new tables | Wrong semantics; closes shop for one person's Urlaub; Arzt becomes a job pause |
| **B. HR module + reuse `Employee` (chosen)** | Clear boundaries; roster already exists | Two holiday vocabularies; two punch UIs for mechanics |
| **C. Full HCM / payroll (rejected)** | Future-proof | Over-build; no payroll product yet |
| **D. Separate `HrPerson` table (rejected)** | Clean HR isolation | Duplicate names with board mechanics |
| **E. Leave approval state machine now (deferred)** | Formal Urlaub process | Too heavy for a small shop Phase 1 |
| **F. Interval rows (`started_at`/`ended_at`) for attendance (rejected)** | Mirrors `LaborEntry` | Doctor and Pause are states, not a second open interval model; event log is simpler |

## Pragmatic Enforcer Analysis

**Necessity (current):** 8/10 — operators asked for clock + remaining holidays; the roster was designed for this.

**Necessity (future payroll):** 3/10 — do not model wage types now.

**Complexity:** 5/10 — three tables, a small state machine, workday helper reusing planner hours.

**Cost of waiting:** High for attendance (spreadsheets); Low for approval workflow and kiosk.

**Simpler alternative considered:** reuse `LaborEntry` — rejected on semantics, not on effort.

**Recommendation:** Approve with Phase 1 cuts already in the spec (no approval, no kiosk, no payroll, no job-start gate).

**Pragmatic score:** complexity/necessity ≈ 0.6 (under 1.5 target).

**Deferred until triggered:**

| Deferral | Trigger |
|----------|---------|
| Leave REQUESTED → APPROVED | Shop asks to prevent self-booking |
| Krankenstand as leave type | Need sick days on the calendar |
| Clock-in required to start a task | Evidence of unpaid floor time |
| PIN kiosk | Shared tablet at the door without personal login |
| Payroll / overtime | Legal or accountant requirement |

## Validation

- Schema tests for tenant-scoped uniques and composite FKs
- Transition matrix tests for attendance `409`
- Workday tests against closed Sunday + closed `WorkshopHoliday`
- Leave remaining tests including cancel restore
- Planner warning tests: leave does not `409` a bay booking
- TECH cannot read `/api/hr/attendance`

## References

- [Feature Spec: HR Time and Leave](../02-Feature-Specs/HR/2026-08-22-hr-time-and-leave.md)
- [ADR-0019: Workshop Planner Calendar](2026-08-21-workshop-planner-calendar.md)
- [ADR-0018: Workshop Planner Kanban Board](2026-04-18-workshop-planner-kanban-board.md)
- [ADR-0014: Mechanic Digital Repair Order Tablet RBAC](2026-04-27-mechanic-digital-repair-order-tablet-rbac.md)
- [ADR-0013: Row-Level Multi-Tenancy](2026-04-15-row-level-multi-tenancy.md)
- [Feature Spec: Workshop Board Resources](../02-Feature-Specs/Workshop/workshop-board-resources.md)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [HR Time and Leave](https://linear.app/auto-core-platform/project/hr-time-and-leave-7e0299d12e1f) |
| Milestone | Spec review |
| Issues | [AUT-179](https://linear.app/auto-core-platform/issue/AUT-179/po-approve-hr-time-and-leave-spec-adr-0020) |
