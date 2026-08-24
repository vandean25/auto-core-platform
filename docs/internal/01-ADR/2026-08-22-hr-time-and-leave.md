---
title: "ADR-0020: HR Time and Leave (Attendance ≠ Labor, Leave ≠ Shop Holiday)"
date: "2026-08-22"
status: accepted
deciders: "Product Owner, Architecture, Backend Lead, Frontend Lead"
linear-project: "HR Time and Leave"
linear-milestone: "Minutes & schedules amendment"
tags:
  - adr
  - hr
  - attendance
  - leave
  - employee
  - work-schedule
---

# ADR-0020: HR Time and Leave (Attendance ≠ Labor, Leave ≠ Shop Holiday)

## Status

**Accepted** — 2026-08-22

**Amended** — 2026-08-24 (minutes-based leave, employee work schedules, explicit no-earnings scope)

PO review approved the Feature Spec (second pass 2026-08-22). Phase 1 shipped with day-based leave. This amendment defines Phase 2: **employee work schedules** and **leave entitlement in minutes** so mid-year working-hour changes do not break leave math. **Payroll, wages, and earnings remain permanently out of scope.**

Implementation must follow identity ruling 12 (Firebase UID match, never `Employee.user_id = session.userId`), auto-close ruling 13 (`occurred_at = now()`, not local midnight), and ruling 7 (PATCH `annualLeaveMinutes` keeps current-year `allowance_minutes` in sync).

## Context

ACP now has three time-related ideas that look similar and must stay distinct:

| Concept | Owner | Question |
|---------|-------|----------|
| Shop hours + `WorkshopHoliday` | Workshop / ADR-0019 | Is the **workshop** open this day? |
| Board assignment + `LaborEntry` | Workshop / ADR-0018 + ADR-0014 | Who is on **this job**, and for how long? |
| Person attendance + Urlaub | HR / ADR-0020 | Is this **human** at work, on pause, at the doctor, home, or on holiday — and how much leave time remains? |

[Feature Spec: Workshop Board Resources](../02-Feature-Specs/Workshop/workshop-board-resources.md) already chose a general-purpose `Employee` table "usable by future features (timesheets, RBAC, payroll)". Settings → Employees is the roster. `TenantMember` is the login (`OWNER` / `ADMIN` / `TECH` / `SALES`).

If we store employee leave as `WorkshopHoliday`, the planner grid closes for the whole shop when one mechanic is on holiday. If we store "came to work" as `LaborEntry`, we invent a dummy workshop task and pollute billable job time with Arzt and Pause.

The product request is an **HR module**: add employees, punch Come / Pause / Doctor / Go home, track remaining holidays, book holidays, and know **when** and **how long** each person is expected to work.

### Amendment trigger (2026-08-24)

Phase 1 stores leave as **whole days** (`annual_leave_days`, `days_charged`). That breaks when:

- Shop or employee working hours change mid-year (shorter Fridays, new open/close times).
- Part-time employees work fewer minutes per day than full-time colleagues.
- A "leave day" no longer equals a fixed amount of time.

**Product clarification:** HR tracks **time planning only** — expected schedule, actual attendance, and leave balance. It does **not** track what someone earns (no hourly rates, wages, gross pay, or payroll).

**Decision:** Store leave entitlement and bookings in **minutes**. Add a versioned **employee work schedule** so expected minutes per workday can change over time without rewriting history.

## Decision Drivers

* Keep workshop occupancy (bays) separate from people occupancy (leave).
* Keep job timers (`LaborEntry`) as an audit of work on a task.
* Reuse `Employee` — do not grow a parallel `HrPerson` table.
* Phase 1 shipped without payroll, approval workflows, or a PIN kiosk — **payroll stays deferred permanently** unless a separate legal/accounting ADR is written.
* Tenant isolation, OpenAPI contract, and deletion policy stay non-negotiable.
* YAGNI: smallest model that answers "are they here?", "when should they work?", "how many leave minutes remain?"
* Mid-year schedule changes must not require recalculating past leave bookings.

## Decision

### 1. Module and ownership

- **Primary module:** HR (`apps/core-api/src/hr/`, frontend `/hr/*`).
- **Person record:** existing `Employee`. Phase 1 added `hired_on` and `annual_leave_days`. Phase 2 **replaces** `annual_leave_days` with `annual_leave_minutes` (migration).
- **Login record:** existing `TenantMember`. Self-service requires `Employee.user_id`.
- **Does not introduce:** a second person table, `Appointment` for leave, payroll, wage types, hourly pay rates, Krankenstand days, leave approval states, door kiosk.
- **Does not reuse:** `LaborEntry`, `LaborPauseReason`, `WorkshopHoliday` rows for employee Urlaub, `LaborOperation.hourly_rate` for employee compensation.

### 2. Attendance is an event log (unchanged from Phase 1)

`AttendanceEvent` is append-only: `CLOCK_IN`, `PAUSE`, `DOCTOR`, `CLOCK_OUT`, with `source` `SELF` | `MANAGER` | `AUTO_SHIFT_CLOSE`.

Current state is derived from the latest event by `occurred_at`. Illegal transitions return `409`. Nightly close inserts `CLOCK_OUT` / `AUTO_SHIFT_CLOSE` with `occurred_at = now()` at `59 23 * * *`, same pattern as `LaborEntry` / `MechanicSchedulerService`. Do not load `WorkshopSettings` from SystemPrisma.

**Why not `LaborEntry`?** That row requires `workshop_task_id` and drives task status (`WAITING_PARTS`, etc.). HR pause is not a job pause.

**Why events instead of open interval rows?** Four punch types are a state machine on a person, not a start/end pair per job. A log is enough to rebuild the day. Manager corrections are extra events, never updates (same immutability spirit as `LaborEntry`).

Clock-in does **not** start a workshop task. Starting a task does **not** require being clocked in (Phase 1). Floor flow stays unblocked (ADR-0018 / ADR-0019 operational bias).

Attendance answers **actual presence**. It is not multiplied by any pay rate.

### 3. Employee work schedule (Phase 2 — new)

Each employee has a **versioned work schedule** describing when they are expected to work and for how long. Schema mirrors `WorkshopOpeningHour` (seven weekday child rows, `HH:MM` strings, ADR-0013 tenant isolation). No JSON blob.

```prisma
model EmployeeWorkSchedule {
  id             String   @id @default(uuid())
  tenant_id      String
  tenant         Tenant   @relation(fields: [tenant_id], references: [id])
  employee_id    String
  employee       Employee @relation(fields: [tenant_id, employee_id], references: [tenant_id, id], onDelete: Restrict)
  effective_from DateTime @db.Date
  days           EmployeeWorkScheduleDay[]
  createdAt      DateTime @default(now())

  @@unique([tenant_id, id])
  @@unique([tenant_id, employee_id, effective_from])
  @@index([tenant_id])
  @@map("employee_work_schedules")
}

model EmployeeWorkScheduleDay {
  id            String               @id @default(uuid())
  tenant_id     String
  tenant        Tenant               @relation(fields: [tenant_id], references: [id])
  schedule_id   String
  schedule      EmployeeWorkSchedule @relation(fields: [tenant_id, schedule_id], references: [tenant_id, id], onDelete: Cascade)
  weekday       Int                  // ISO 1–7, same as WorkshopOpeningHour
  is_working    Boolean
  start_time    String?              // HH:MM; required when is_working
  end_time      String?
  break_minutes Int                  @default(0)

  @@unique([tenant_id, id])
  @@unique([tenant_id, schedule_id, weekday])
  @@index([tenant_id])
  @@map("employee_work_schedule_days")
}
```

**Resolution rule:** For any calendar date `D`, use the schedule version with the greatest `effective_from` where `effective_from <= D`. Missing schedule on `D` → `400` (should not happen after seed + migration).

**Write semantics:**

- Mid-year pattern change → **POST** a new version with a later `effective_from`. Never retcon an old version's `effective_from`.
- Duplicate `effective_from` for the same employee → `409`.
- Correction of times on an existing version → **PATCH** `/api/hr/employees/:id/work-schedule/:scheduleId` (leave snapshots are not rewritten; only future bookings use corrected times).
- No hard-delete API. Employee hard-delete stays blocked if schedule rows exist.
- Future-dated `effective_from` is allowed.

**Defaults:** On employee create, seed one schedule from current tenant `WorkshopOpeningHour` rows (`is_working = !is_closed`, copy `open_time`/`close_time`, `break_minutes = 0`) with `effective_from = hired_on` (or tenant-local today if null). `break_minutes = 0` means door-to-door shop window (e.g. 07:30–17:00 = 570 min), not a contracted 8 h — do not invent a lunch default without PO.

Managers edit per-employee patterns when someone works part-time or different hours than the shop default.

**Shop vs employee schedule:** Shop hours (ADR-0019) define bay availability and fully closed public holidays. Employee schedule defines **this person's** expected working time. A day can be shop-open but employee-off (e.g. Tuesday–Saturday mechanic). Shop hour edits do not rewrite employee schedules; live shop calendar only zeros fully closed days at **booking** time (Phase 1 parity).

### 4. Leave is a date-range request in minutes, not a shop holiday

`LeaveRequest` (`start_on`, `end_on`, `status` `BOOKED` | `CANCELLED`, snapshotted `minutes_charged`).

`EmployeeLeaveBalance` per `(employee, year)` holds `allowance_minutes` and `carryover_minutes`. Remaining is computed:

```
allowance_minutes + carryover_minutes − SUM(minutes_charged WHERE status = BOOKED AND year matches)
```

**`avg_expected_minutes_per_workday`:** Mean of `(end_time − start_time) − break_minutes` over `is_working` weekdays in the **current** schedule version (not ÷7, not closed weekdays). Example: part-time 4 h × 3 days → `avg = 240`.

**Chargeable minutes** for a date range (single algorithm for booking and `HrWorkdayService`):

```
for each date D in [start_on, end_on]:
  schedule = latest EmployeeWorkSchedule where effective_from <= D
  weekday  = ISO weekday of D
  if !schedule.days[weekday].is_working → 0
  if shop fully closed on D
     (weekday WorkshopOpeningHour.is_closed, or matching WorkshopHoliday.is_closed)
     → 0
  else → (end_time − start_time) − break_minutes   // employee window only

minutes_charged = Σ charge for each D
```

- `end_time <= start_time` or `break_minutes` ≥ span → `400`. No overnight shifts (shop hours have none).
- **Short shop days (Phase 1 parity):** a short `WorkshopHoliday` (`is_closed = false`) still charges a **full employee workday of minutes**, not the shop's shortened window. Do not `min()` with shop open/close.
- Zero chargeable minutes for the range → `400` (same as zero workdays in Phase 1).
- Half-days remain deferred; when added, they charge a defined fraction of that date's employee minutes.

`Employee.annual_leave_minutes` is the live entitlement. The yearly row snapshots `allowance_minutes` on first leave read/create. Changing this year's entitlement (employee PATCH `annualLeaveMinutes` or leave-balance PATCH `allowanceMinutes` for the current local year) must write **both** so remaining cannot diverge from the Leave column (ruling 7). Past years stay snapshotted. Carryover is only on the yearly row; carryover PATCH is in minutes (if UI accepts "days", convert at save with current `avg`).

**UI display:** APIs and UI may show derived "days" as `remaining_minutes ÷ current_avg_workday_minutes` for familiarity. Storage and booking validation always use **minutes**. `remainingLeaveMinutes` is always a number, never null (ruling 16).

**Granting allowance:** When a manager sets "25 days" in the UI, convert at save time:

```
annual_leave_minutes = 25 × avg_expected_minutes_per_workday(employee, current schedule)
```

Round to nearest integer minute. On new employee create: seed schedule, then set `annual_leave_minutes` in the same transaction (Prisma default must not stay `25` days). Snapshot the result; later schedule changes affect future bookings only, not the annual pot. After a mid-year FTE change, **remaining minutes do not auto-pro-rate**; derived "days" display will move — that is the chosen tradeoff.

Phase 1 has **no approval workflow**. Booking writes `BOOKED` immediately if remaining and overlap checks pass.

**Phase 1 invariants preserved:**

- Booking/PATCH still `400` if `start_on`/`end_on` span two calendar years.
- `PATCH /api/hr/leave/:id` **recomputes** `minutes_charged` for the new range (new snapshot, not a silent rewrite from a later schedule change).
- Clock-in allowed on a BOOKED leave day (no 409).

**Why not `WorkshopHoliday`?** That entity overrides **bay** opening hours for every advisor. One mechanic on holiday must not empty the planner grid.

**Why minutes, not days?** When working hours change mid-year, one "day" of leave is ambiguous. Minutes are the atomic unit; each booked date charges the expected minutes active on that date.

**Snapshot at booking:** `minutes_charged` is written when the leave is created. Later schedule or shop-hour edits do not rewrite old bookings (same spirit as Phase 1 `days_charged` and invoice line snapshotting).

### 5. Migration from Phase 1 (days → minutes)

Phase 1 columns (`annual_leave_days`, `allowance_days`, `carryover_days`, `days_charged`) are replaced in a single Prisma migration:

| Phase 1 | Phase 2 |
|---------|---------|
| `annual_leave_days` | `annual_leave_minutes` |
| `allowance_days` | `allowance_minutes` |
| `carryover_days` | `carryover_minutes` |
| `days_charged` | `minutes_charged` |

**Data migration rule:** Use **one conversion factor per employee** for every day column so remaining leave is invariant at cutover:

```
avg = mean(expected_minutes of is_working weekdays in seeded current schedule)
     // not /7, not closed weekdays

annual_leave_minutes = annual_leave_days × avg
allowance_minutes    = allowance_days × avg
carryover_minutes    = carryover_days × avg
minutes_charged      = days_charged × avg     // do not recompute from date ranges
```

Round to nearest integer minute. `remaining_minutes` after migration = `remaining_days × avg`.

Also in the same migration:

- INSERT one `EmployeeWorkSchedule` (+ seven `EmployeeWorkScheduleDay` rows) for **every existing employee** from current `WorkshopOpeningHour` (`is_working = !is_closed`, times copied, `break_minutes = 0`), `effective_from = hired_on` or tenant-local today.
- Use `480` only if the tenant has no opening-hour rows; document that fallback. Default shop Mon–Fri 07:30–17:00 is 570 minutes with `break_minutes = 0`.

Drop day columns after backfill. OpenAPI and frontend types regenerated.

### 6. Planner integration is advisory (unchanged)

`GET /api/workshop/planner` gains `employeesAway[]` for BOOKED leave overlapping the window. The UI warns (amber). Bay overlap remains the only hard `409` (ADR-0019). Mechanic-on-leave is the same class of warning as mechanic double-book.

### 7. API split

- Keep `/api/employees` for roster CRUD (board, Settings, HR table). HR fields live there — do not create `/api/hr/employees` as a second CRUD.
- Clock and leave live under `/api/hr` and `@MechanicAccessible()` only on `/api/hr/me/*`.
- **New (Phase 2):** `GET /api/hr/employees/:id/work-schedule` (current + history), `POST` new version, `PATCH /api/hr/employees/:id/work-schedule/:scheduleId` for corrections on an existing version. SALES → `403` on schedule writes.
- **OpenAPI field renames (breaking):** `annualLeaveDays` → `annualLeaveMinutes`, `remainingLeaveDays` → `remainingLeaveMinutes`, `allowanceDays`/`carryoverDays`/`remainingDays` → `*Minutes`, `daysCharged` → `minutesCharged`. Optional derived `approxRemainingDays = remainingMinutes / current_avg` is display-only.
- Resolve "me" via linked `User.firebaseUid` / `email` (session `userId` is Firebase UID). Do not call `MechanicIdentityService.resolveMechanic()` (TECH + MECHANIC only).
- OWNER/ADMIN book leave for any employee with `POST /api/hr/leave`. Mechanic shell has no leave UI in Phase 1.
- OWNER/ADMIN punch for another employee with `POST /api/hr/attendance` (`occurredAt` now in the UI). SALES may still write roster fields on `/api/employees` but not `hiredOn` / `annualLeaveMinutes` / work schedule.
- Workday math lives in `HrWorkdayService` that **reads** workshop hours/holidays **and** employee schedules. Replace `countChargeableDays` with `countChargeableMinutes(employeeId, from, to)`; remove `countChargeableDays` after migration (no dual units). Do not call OpenHolidays from HR. Do not grow `workshop-planner.service.ts` with leave booking.

### 8. Real-time, deletion, fiscal, inventory

- **Realtime:** opt-in `ATTENDANCE_EVENT`, `LEAVE_REQUEST`, and `EMPLOYEE_WORK_SCHEDULE`. Leave also invalidates planner query keys.
- **Deletion:** attendance never hard-deleted; leave is cancelled; employee hard-delete blocked when attendance, leave, balance, or schedule rows exist. `EmployeeWorkSchedule` (+ day children) added to `docs/deletion-policy.md`: no API delete; cascade only with employee/tenant purge.
- **Fiscal / inventory / payroll:** none. No wage fields on any HR table.

## Consequences

### Positive

- One person identity from board → tablet → HR.
- Shop holidays and employee holidays cannot corrupt each other.
- Job time and presence time stay independently auditable.
- Remaining leave is deterministic from allowance, carryover, and BOOKED minute snapshots.
- Mid-year working-hour changes affect only future per-day charge calculations, not the meaning of the annual balance.
- Part-time and full-time employees can share one leave model without unfair "one day = one day" assumptions.

### Negative

- Two "holiday" words in the product (shop holiday vs employee holiday). Docs and UI labels must say **Public / shop holiday** vs **Leave**.
- Two punch systems on the mechanic tablet (job start/pause vs HR clock). Labels must stay distinct.
- Application-level overlap checks for leave can theoretically race; same acceptance as planner bay overlap until proven otherwise.
- Phase 2 migration from days to minutes is a breaking API change (see §7 OpenAPI renames).
- Employee work schedules add UI and CRUD surface area beyond Phase 1.
- After a mid-year FTE or schedule change, remaining **minutes** stay fixed but derived "days" display shifts — managers must understand the tradeoff.

### Neutral

- Sidebar grows by one **HR** item (Phase 1).
- Settings → Employees remains; it is not a second roster.
- "Days" may still appear in the UI as a derived display unit.

## Implementation Strategy

### Blast Radius

**Phase 1 (shipped):** New tables and `/api/hr`. Employee DTO additive fields. Planner GET additive `employeesAway`. Mechanic queue header gains a punch bar.

**Phase 2 (this amendment):** `EmployeeWorkSchedule` table. Column renames day → minute on `Employee`, `EmployeeLeaveBalance`, `LeaveRequest`. `HrWorkdayService` minute math. Employee schedule editor on HR employee sheet. Migration script for existing tenants.

**Affected Components:**

- `Employee` schema — `annual_leave_minutes`; drop `annual_leave_days`
- `EmployeeWorkSchedule` — new
- `HrWorkdayService` — `countChargeableMinutes`
- `HrLeaveService` — minute remaining and booking validation
- HR employee sheet — schedule editor + minute-based leave display
- OpenAPI / frontend generated types — field renames

**User Impact:** Managers set per-employee schedules and see leave in minutes (with optional "≈ X days" helper). Mechanics unchanged.

**Risk Mitigation:**

- Spec forbids mixing models; e2e asserts `LaborEntry` is untouched by HR punches
- TECH locked to `/me` via existing `@MechanicAccessible()` guard
- Snapshot `minutes_charged` so schedule edits do not rewrite history
- Migration backfill tested on staging with real-shaped data

### Reversibility

**Reversibility Level:** Medium. Additive schedule table; minute columns are a migration from day columns. Dropping HR tables is a migration if unused; once punches exist they are audit data.

**Rollback Feasibility:** Hide schedule UI. Revert to day columns only if migration not yet run in production.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **A. Stretch `LaborEntry` + `WorkshopHoliday` (rejected)** | No new tables | Wrong semantics; closes shop for one person's Urlaub; Arzt becomes a job pause |
| **B. HR module + reuse `Employee` (chosen)** | Clear boundaries; roster already exists | Two holiday vocabularies; two punch UIs for mechanics |
| **C. Full HCM / payroll (rejected)** | Future-proof | Over-build; no payroll product goal |
| **D. Separate `HrPerson` table (rejected)** | Clean HR isolation | Duplicate names with board mechanics |
| **E. Leave approval state machine now (deferred)** | Formal Urlaub process | Too heavy for a small shop Phase 1 |
| **F. Interval rows (`started_at`/`ended_at`) for attendance (rejected)** | Mirrors `LaborEntry` | Doctor and Pause are states, not a second open interval model; event log is simpler |
| **G. Keep day-based leave (rejected in amendment)** | Simpler Phase 1 model | Breaks when hours change mid-year or differ per employee |
| **H. Store earnings / hourly wage on employee (rejected)** | Enables payroll later | Out of product scope; user explicitly does not want earnings tracking |
| **I. Use shop hours only, no per-employee schedule (rejected)** | Fewer tables | Cannot model part-time or personal patterns; all employees assumed shop hours |

## Pragmatic Enforcer Analysis

**Necessity (current):** 8/10 — operators asked for clock + remaining holidays; roster was designed for this. Amendment adds 7/10 — mid-year hour changes and fair part-time leave require minutes + schedules.

**Necessity (future payroll):** 0/10 — explicitly out of scope. Do not add wage fields "for later."

**Complexity:** 6/10 — Phase 1 three tables + state machine; Phase 2 adds schedule versioning, minute math, and a breaking migration.

**Cost of waiting:** High for attendance (already shipped); Medium for minutes migration (day-based leave drifts wrong as hours change).

**Simpler alternative considered:** Keep days, recalculate on schedule change — rejected because it rewrites history and confuses remaining balance.

**Recommendation:** Approve amendment. Ship Phase 2 as incremental PRs: schema + migration, `HrWorkdayService` minutes, schedule CRUD, UI.

**Pragmatic score:** complexity/necessity ≈ 0.75 (under 1.5 target).

**Deferred until triggered:**

| Deferral | Trigger |
|----------|---------|
| Leave REQUESTED → APPROVED | Shop asks to prevent self-booking |
| Krankenstand as leave type | Need sick days on the calendar |
| Clock-in required to start a task | Evidence of unpaid floor time |
| PIN kiosk | Shared tablet at the door without personal login |
| Half-day leave | Product asks for partial-day booking |
| Payroll / overtime / wages | Separate legal or accountant ADR — not part of HR time planning |
| Expected vs actual hours report | Manager asks for monthly attendance variance |

## Validation

- Schema tests for tenant-scoped uniques and composite FKs on `EmployeeWorkSchedule` and `EmployeeWorkScheduleDay`
- Transition matrix tests for attendance `409`
- Minute charge tests: closed Sunday + closed `WorkshopHoliday` → 0 minutes
- Minute charge tests: short `WorkshopHoliday` (`is_closed = false`) charges full employee minutes
- Minute charge tests: mid-year schedule change charges different minutes for same calendar span before/after `effective_from`
- Duplicate `effective_from` on schedule POST → `409`; `end_time <= start_time` → `400`; zero-minute range → `400`
- Leave remaining tests including cancel restore (minutes); PATCH leave recomputes `minutes_charged`
- Migration test: day columns correctly backfilled with single `avg` factor; remaining invariant preserved
- Seed-on-create schedule test; existing-employee backfill test
- SALES `403` on schedule and `annualLeaveMinutes` writes
- Planner warning tests: leave does not `409` a bay booking
- TECH cannot read `/api/hr/attendance`
- No `hourly_rate` or wage fields on HR entities (grep / schema test)

## References

- [Feature Spec: HR Time and Leave](../02-Feature-Specs/HR/2026-08-22-hr-time-and-leave.md) — **this amendment supersedes** Feature Spec workday counting, leave units, and DTO field names. Do not implement Phase 2 from the spec until it is amended to match.
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
| Milestone | Minutes & schedules amendment |
| Issues | [AUT-192](https://linear.app/auto-core-platform/issue/AUT-192) (spec), [AUT-193](https://linear.app/auto-core-platform/issue/AUT-193) (schema), [AUT-194](https://linear.app/auto-core-platform/issue/AUT-194) (leave minutes), [AUT-195](https://linear.app/auto-core-platform/issue/AUT-195) (schedule API), [AUT-196](https://linear.app/auto-core-platform/issue/AUT-196) (frontend), [AUT-197](https://linear.app/auto-core-platform/issue/AUT-197) (docs) |
