---
title: "HrClockPage"
date: "2026-08-22"
tags:
  - component-spec
  - hr
  - attendance
  - leave
  - shadcn
---

# HR pages (Employees, Time Clock, Leave)

## Purpose

Office HR surface at `/hr/*`. One sidebar item **HR**. Tabs switch Employees, Time Clock, and Leave. Mechanics do not use these routes; they get `AttendancePunchBar` on `/mechanic/queue`.

This is not Settings Hours (shop holidays) and not the Workshop Planner.

Target files:

- `apps/core-web/src/pages/hr/HrLayout.tsx`
- `apps/core-web/src/pages/hr/HrEmployeesPage.tsx`
- `apps/core-web/src/pages/hr/HrClockPage.tsx`
- `apps/core-web/src/pages/hr/HrLeavePage.tsx`
- `apps/core-web/src/components/hr/AttendancePunchBar.tsx`
- `apps/core-web/src/components/hr/LeaveBookingSheet.tsx`
- `apps/core-web/src/components/hr/TeamLeaveMonthGrid.tsx`
- Reuse: `apps/core-web/src/components/settings/EmployeeSettingsTab.tsx`

Source of truth: [Feature Spec: HR Time and Leave](../../02-Feature-Specs/HR/2026-08-22-hr-time-and-leave.md), [ADR-0020](../../01-ADR/2026-08-22-hr-time-and-leave.md).

## Layout (`HrLayout`)

- **Top-left:** title `HR` (`text-2xl font-semibold tracking-tight`), subtitle from the active tab (`text-slate-500`).
- **Tabs** under the title: `Employees` | `Time Clock` | `Leave` (shadcn `Tabs`, URL `/hr/employees`, `/hr/clock`, `/hr/leave`).
- **Top-right:** tab-specific actions only (`+ Employee`, none on clock, `+ Leave`).

Do not put punch buttons in the layout header except on the Time Clock tab (they live in `AttendancePunchBar`).

## HrEmployeesPage

Reuse the Settings employees DataTable. Additional columns:

| Column | Control |
|--------|---------|
| Hire date | Inline date, save-on-blur (`hiredOn`) |
| Leave days | Inline int ≥ 0 (`annualLeaveDays`) |
| Remaining | Read-only computed `remainingLeaveDays` |
| Login | Existing linked user (unchanged) |

Search includes name, role, hire date, remaining. Row click opens a sheet with the same fields. Right-click Delete unchanged.

Settings → Employees renders this same table so there is not a second roster.

## AttendancePunchBar

Shared by `HrClockPage` and the mechanic queue header.

### Props

| Prop | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `state` | `'CLOCKED_OUT' \| 'CLOCKED_IN' \| 'PAUSED' \| 'AT_DOCTOR'` | — | Yes | Derived server state |
| `pending` | `boolean` | `false` | No | Mutation in flight |
| `onPunch` | `(type: 'CLOCK_IN' \| 'PAUSE' \| 'DOCTOR' \| 'CLOCK_OUT') => void` | — | Yes | POST `/api/hr/me/clock` |

### Buttons (left to right)

| Label | Type | Enabled when |
|-------|------|----------------|
| Come to work | `CLOCK_IN` | `CLOCKED_OUT`, `PAUSED`, `AT_DOCTOR` |
| Pause | `PAUSE` | `CLOCKED_IN` |
| Doctor | `DOCTOR` | `CLOCKED_IN` |
| Go home | `CLOCK_OUT` | `CLOCKED_IN`, `PAUSED`, `AT_DOCTOR` |

Disabled buttons stay visible (do not hide). Current state uses `StatusBadge`.

Copy must not say "Start job" or reuse mechanic pause reasons.

### Required shadcn/ui

- `Button` (large on `/hr/clock`, compact on mechanic queue)
- `StatusBadge` — add `CLOCKED_IN`, `CLOCKED_OUT`, `AT_DOCTOR` to `statusClassMap` if missing (`PAUSED` already exists)
- `Skeleton` while `/api/hr/me/clock` loads

Icons: `lucide-react` only (`LogIn`, `Pause`, `Stethoscope`, `LogOut`).

## HrClockPage

- Punch bar top-right of the tab content (page action).
- Timeline: today's events, newest last, time in tenant timezone.
- OWNER/ADMIN: employee filter + `GET /api/hr/attendance` table for the selected day (DataTable). SALES/self: own timeline only.

Empty state if `/api/hr/me` is 403: Card "No employee record linked" + link to HR Employees / Settings Team.

## HrLeavePage

- **Top-right:** remaining chip `Remaining: {n} days` + `+ Leave`.
- List of own bookings (DataTable). Row click opens sheet (view). Right-click Cancel when allowed.
- OWNER/ADMIN and SALES: `TeamLeaveMonthGrid` below (CSS grid, employees × days). BOOKED cells use `StatusBadge`. Click empty cell (OWNER/ADMIN only) opens `LeaveBookingSheet` with that employee + day. No FullCalendar.

### LeaveBookingSheet

- `Sheet` (not Dialog). Primary action top-right of `SheetHeader`: `+ Leave`.
- Fields: employee (locked to self unless OWNER/ADMIN), start, end, note.
- Preview line: none in Phase 1 (no extra preview API). After submit, the leave list shows `daysCharged`.
- OWNER/ADMIN sheet includes employee select and submits `POST /api/hr/leave`. Self-service submits `POST /api/hr/me/leave`.
- Insufficient remaining or overlap: toast from `409` message; sheet stays open.

## Mechanic queue

Render compact `AttendancePunchBar` in the queue page header, right side, **separate** from job Start/Pause. Do not mix with `LaborPauseReason` dialogs.

## Query keys

Use `hrKeys` from `apps/core-web/src/api/hr.ts` (see feature spec). Invalidate `hrKeys.all` on clock/leave mutations. Invalidate `employeeKeys.all` when remaining may change. Invalidate `workshopKeys.all` (planner) on leave create/cancel.

## Realtime

`ATTENDANCE_EVENT` → `hrKeys.all`. `LEAVE_REQUEST` → `hrKeys.all` + `workshopKeys.all`.

## Related

- `EmployeeSettingsTab.tsx` — roster reuse
- `WorkshopPlannerPage` — consume `employeesAway`; do not book leave there
- Mechanic task Start/Pause — job labor, not this punch bar
