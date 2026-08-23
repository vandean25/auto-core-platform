# HR Employees, Clock, Leave, and Planner Warning Design

## Goal

Implement the frontend HR surfaces from AUT-183 and the mechanic clock/planner leave warning from AUT-184 on top of the attendance and leave APIs already present on `main`.

## Scope

### AUT-183: Office HR

- Add an HR sidebar module at `/hr/employees` with tabs for Employees, Time Clock, and Leave.
- Reuse one employee roster implementation in Settings and HR.
- Add hire date, annual leave allowance, computed remaining leave, linked login, and current-year carryover editing to the employee surface.
- Add the employee clock timeline and role-aware manager punch-for-other controls.
- Add leave bookings, cancellation, remaining-days display, and the team month calendar.
- Add the shared `AttendancePunchBar` component and StatusBadge mappings.
- Add typed HR query factories and mutations using the generated OpenAPI types.

### AUT-184: Mechanic clock and planner warning

- Render a compact `AttendancePunchBar` in the mechanic queue header, separate from workshop job controls.
- Hide that bar when the current user has no linked employee and the HR endpoint returns `403`.
- Extend the planner response with `employeesAway` for overlapping `BOOKED` leave.
- Display an amber advisory warning for affected mechanics while leaving planner booking enabled.
- Invalidate HR and planner queries for attendance and leave realtime events.

The work does not introduce payroll, approval workflows, sick-leave types, half-days, a kiosk, or a hard planner conflict for employee leave. It does not reuse `LaborEntry`, `LaborPauseReason`, or `WorkshopHoliday` for HR attendance or leave.

## Existing contracts and constraints

- The HR schema and `/api/hr` attendance/leave endpoints are already implemented by AUT-181 and AUT-182.
- `/api/employees` remains the single employee CRUD surface. HR-specific fields are `hiredOn`, `annualLeaveDays`, and `remainingLeaveDays`.
- The HR clock state is `CLOCKED_OUT`, `CLOCKED_IN`, `PAUSED`, or `AT_DOCTOR`; punch types are `CLOCK_IN`, `PAUSE`, `DOCTOR`, and `CLOCK_OUT`.
- Leave statuses are `BOOKED` and `CANCELLED`.
- OWNER/ADMIN may edit HR employee fields, punch for another employee, manage all leave, and edit carryover. SALES may read the team leave calendar and sees HR employee fields read-only. TECH uses only `/api/hr/me/*` and the mechanic queue clock bar.
- Tenant scoping remains server-owned. The planner leave query must include the current tenant and only return `BOOKED` leave overlapping the requested planner range.
- OpenAPI remains authoritative. Adding `employeesAway` requires regenerating `apps/core-api/openapi/openapi.json` and `apps/core-web/src/api/generated/openapi.ts`.

## Design

### 1. Shared HR API layer

Create `apps/core-web/src/api/hr.ts` with one `hrKeys` factory:

```ts
export const hrKeys = {
  all: ['hr'] as const,
  me: () => [...hrKeys.all, 'me'] as const,
  clock: () => [...hrKeys.all, 'clock'] as const,
  attendance: (from: string, to: string, employeeId?: string) =>
    [...hrKeys.all, 'attendance', from, to, employeeId ?? 'all'] as const,
  myLeave: (year: number) => [...hrKeys.all, 'me-leave', year] as const,
  leave: (from: string, to: string, employeeId?: string) =>
    [...hrKeys.all, 'leave', from, to, employeeId ?? 'all'] as const,
}
```

The module will expose typed hooks for current employee state, current clock state, self and manager punches, own leave, team leave, leave creation/cancellation/update, attendance ranges, and leave-balance updates. All requests use `fetchWithAuth`; mutations invalidate `hrKeys.all`, `employeeKeys.all` when remaining leave can change, and `workshopKeys.planner` after leave mutations.

### 2. Reusable employee roster

Extract the existing table behavior from `EmployeeSettingsTab` into a focused HR employee table component or shared table module. Keep Settings as a consumer so there is no second roster implementation.

The table will retain existing search, sortable headers, pagination, inline name/role/language/status/sort-order controls, and right-click delete/deactivate behavior. It will add hire date, annual leave days, remaining leave, and linked login columns. Hire date and annual leave edits are save-on-blur/select and are disabled for SALES. A row opens an employee sheet containing the same fields plus current-year carryover; OWNER/ADMIN can save carryover through `PATCH /api/hr/employees/:id/leave-balance`.

The `HrEmployeesPage` supplies the HR page header and `+ Employee` action. Settings continues to render the same table under its Employees tab.

### 3. HR layout and routes

Add `apps/core-web/src/pages/hr/HrLayout.tsx` as the route shell. It renders the `HR` title, active-tab subtitle, shadcn Tabs, and an `Outlet`. Tabs navigate to `/hr/employees`, `/hr/clock`, and `/hr/leave`; `/hr` redirects to `/hr/employees`.

Add the three page components under `apps/core-web/src/pages/hr/` and register them in `App.tsx` inside the office shell. Add one visible `HR` item to `AppSidebar` with `Users` icon and `/hr/employees` target. The existing shell redirect keeps TECH users in the mechanic shell, so office HR routes are not available to TECH.

### 4. Attendance punch bar and clock page

Create `AttendancePunchBar` with explicit button labels and Lucide icons:

- Come to work → `CLOCK_IN`
- Pause → `PAUSE`
- Doctor → `DOCTOR`
- Go home → `CLOCK_OUT`

All buttons remain visible; only transitions allowed by the server-derived state are enabled. The component displays the current state with `StatusBadge`, supports pending/disabled state, and accepts a compact presentation for the mechanic queue.

`HrClockPage` loads `/api/hr/me` and `/api/hr/me/clock`, shows the punch bar and today’s timeline in tenant time, and renders a linked-employee empty state for the HR identity `403`. OWNER/ADMIN users receive an employee selector and a selected-day team attendance table. Punching self uses `/api/hr/me/clock`; punching another employee uses `/api/hr/attendance` without a client timestamp. SALES and self-service users see only their own timeline.

### 5. Leave page and month grid

Create `LeaveBookingSheet` using the shadcn Sheet primitive. It contains employee, start date, end date, and note fields. Employee selection is locked to self except for OWNER/ADMIN. Submission is explicit; server `400`/`409` messages are shown in a toast while the sheet remains open.

`HrLeavePage` shows the current remaining-days chip, a top-right `+ Leave` action, own bookings in a DataTable, and allowed cancellation actions. OWNER/ADMIN and SALES also see `TeamLeaveMonthGrid`, implemented with CSS grid rather than FullCalendar. BOOKED cells use `StatusBadge`; empty cells can open a manager booking sheet for OWNER/ADMIN. The grid is read-only for SALES.

### 6. Mechanic queue integration

Render the compact `AttendancePunchBar` in the mechanic queue header, separate from job Start/Pause controls and labor pause dialogs. Wire it to self clock hooks. A `403` from the current clock/profile request means no linked employee; the bar is hidden without showing an error toast. Other errors remain visible through the existing page error handling.

### 7. Planner leave warning

Add `PlannerEmployeeAwayDto` and `employeesAway` to `PlannerGridResponseDto`. `WorkshopPlannerService` will query tenant-scoped `LeaveRequest` rows with `status = BOOKED` whose date range overlaps the planner range, include the employee name, and map them to `{ employeeId, name, startOn, endOn, leaveId }`.

The query is batched once per planner request and does not run inside a booking loop. Cancelled leave is excluded. The planner response remains additive and existing booking behavior is unchanged.

The planner page will compare assigned mechanic IDs with `employeesAway` and show an amber `Alert` identifying the mechanic and leave range. The warning is advisory: create/update booking controls remain enabled and no leave-related `409` is introduced.

### 8. Realtime invalidation

Add `ATTENDANCE_EVENT` and `LEAVE_REQUEST` to the backend dashboard entity type contract if they are not already present. Map attendance events to `hrKeys.all`; map leave requests to `hrKeys.all` and the workshop planner query. Employee mutations continue using employee query invalidation separately.

## Error handling

- Preserve backend authorization as the source of truth; frontend role checks only control available controls.
- Treat HR identity `403` as the documented no-linked-employee empty state on office pages and as a hidden punch bar on the mechanic queue.
- Surface transition conflicts, leave overlap, and insufficient balance messages through the existing error-message/toast pattern.
- Keep leave sheets open after failed submission so users can correct dates or employee selection.
- Treat planner leave data as optional advisory data; an unavailable warning query must not disable booking controls.

## Testing strategy

Use TDD for each new behavior:

- API hook tests verify query keys, request payloads, and invalidation behavior.
- `AttendancePunchBar` tests verify state transition button enablement, labels, pending state, compact rendering, and status badges.
- HR layout tests verify route tab links and active content.
- Employee roster tests verify new columns, role-based editability, sheet carryover update, and shared Settings usage.
- Leave sheet and grid tests verify self/manager payloads, `409` persistence, status rendering, and manager-only empty-cell booking.
- Mechanic queue tests verify compact bar rendering and hidden `403` behavior.
- Planner service tests verify tenant-safe overlapping BOOKED leave, cancellation exclusion, and no per-booking query.
- Planner UI tests verify the amber warning and that booking controls remain enabled.
- Realtime mapping tests verify HR and planner invalidations.
- Regenerate and check OpenAPI artifacts after the planner response change.

## Verification and delivery

Run focused Vitest/Jest tests during implementation, then the repository-required lint, build, API type check, unit, and relevant e2e suites. Create a feature branch using the Linear branch name, commit the implementation, push it, and create one PR with `Fixes AUT-183` and `Fixes AUT-184` in the body.
