# HR Employees, Clock, Leave, and Planner Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver AUT-183’s office HR employees/clock/leave pages and AUT-184’s mechanic clock bar, planner leave contract, reusable leave warning, and realtime invalidation without creating AUT-177’s planner page.

**Architecture:** Keep /api/employees as the single employee roster API and add a typed frontend HR API module around the existing /api/hr endpoints. Build HR as a routed office surface with reusable employee, clock, leave, and warning components. Extend the existing planner API with one tenant-scoped BOOKED-leave query; expose a reusable MechanicAwayAlert for AUT-177’s future calendar page, but do not mount it because WorkshopPlannerPage is absent from main.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL, React 19, TypeScript 5.9, TanStack Query/Table, Vitest, Jest, shadcn primitives, Lucide React, date-fns, generated OpenAPI types.

---

## File map

Backend:
- Modify apps/core-api/src/workshop/dto/workshop-planner.dto.ts — add PlannerEmployeeAwayDto and employeesAway.
- Modify apps/core-api/src/workshop/workshop-planner.service.ts — query and map overlapping BOOKED leave.
- Test apps/core-api/src/workshop/workshop-planner.service.spec.ts and apps/core-api/test/workshop-planner-booking.e2e-spec.ts.
- Regenerate apps/core-api/openapi/openapi.json.

Frontend API and integration:
- Create apps/core-web/src/api/hr.ts and apps/core-web/src/api/hr.test.tsx.
- Modify apps/core-web/src/api/workshop.ts, features/realtime/dashboard-entity-map.ts, and its test.
- Regenerate apps/core-web/src/api/generated/openapi.ts.
- Modify App.tsx, AppSidebar.tsx, StatusBadge.tsx, MechanicQueuePage.tsx, SettingsPage.tsx, and their relevant tests.

Shared HR UI:
- Create components/ui/alert.tsx and components/ui/skeleton.tsx.
- Create components/hr/AttendancePunchBar.tsx and test.
- Create components/hr/MechanicAwayAlert.tsx and test.
- Create components/hr/EmployeeTable.tsx and test; make EmployeeSettingsTab a thin consumer.
- Create LeaveBookingSheet.tsx/test and TeamLeaveMonthGrid.tsx/test.
- Create pages/hr/HrLayout.tsx, HrEmployeesPage.tsx, HrClockPage.tsx, HrLeavePage.tsx and tests.

---

### Task 1: Add planner employeesAway to the backend contract

Files:
- Modify apps/core-api/src/workshop/dto/workshop-planner.dto.ts
- Modify apps/core-api/src/workshop/workshop-planner.service.ts
- Test apps/core-api/src/workshop/workshop-planner.service.spec.ts
- Test apps/core-api/test/workshop-planner-booking.e2e-spec.ts

- [ ] Step 1: Write the failing unit test.

Add a fixture to mockPrisma.leaveRequest.findMany and assert the planner response:

~~~ts
it('includes overlapping BOOKED leave as employeesAway', async () => {
  mockPrisma.leaveRequest.findMany.mockResolvedValue([
    {
      id: 'leave-1',
      employee_id: 'employee-1',
      start_on: new Date('2026-08-24T00:00:00.000Z'),
      end_on: new Date('2026-08-26T00:00:00.000Z'),
      employee: { id: 'employee-1', name: 'Ada Lovelace' },
    },
  ]);

  const result = await service.getPlanner({
    from: '2026-08-24T00:00:00.000Z',
    to: '2026-08-25T00:00:00.000Z',
  });

  expect(result.employeesAway).toEqual([
    {
      employeeId: 'employee-1',
      name: 'Ada Lovelace',
      startOn: '2026-08-24',
      endOn: '2026-08-26',
      leaveId: 'leave-1',
    },
  ]);
});
~~~

Also assert the query is called once with tenant_id, status BOOKED, start_on less than or equal to the local end date, end_on greater than or equal to the local start date, and a selected employee name. Add a test proving cancelled leave is excluded.

- [ ] Step 2: Run the focused test and verify RED.

Run:
~~~powershell
npm test --workspace=core-api -- --runInBand src/workshop/workshop-planner.service.spec.ts
~~~
Expected: the new test fails because employeesAway does not exist and no leave query is made.

- [ ] Step 3: Implement the DTO and one batched query.

Add PlannerEmployeeAwayDto with employeeId, name, startOn, endOn, and leaveId fields. Add employeesAway: PlannerEmployeeAwayDto[] to PlannerGridResponseDto.

In WorkshopPlannerService, derive local date bounds after the planner timezone is known. Query exactly once:
~~~ts
this.prisma.leaveRequest.findMany({
  where: {
    tenant_id: tenantId,
    status: LeaveRequestStatus.BOOKED,
    start_on: { lte: toLocalDate },
    end_on: { gte: fromLocalDate },
  },
  select: {
    id: true,
    employee_id: true,
    start_on: true,
    end_on: true,
    employee: { select: { id: true, name: true } },
  },
  orderBy: [{ start_on: 'asc' }, { employee_id: 'asc' }],
})
~~~
Map dates with the existing local-date formatter and return the array. Do not add a leave conflict to any booking mutation and do not query inside a booking loop.

- [ ] Step 4: Run the focused unit test and verify GREEN.
~~~powershell
npm test --workspace=core-api -- --runInBand src/workshop/workshop-planner.service.spec.ts
~~~

- [ ] Step 5: Add an HTTP test to workshop-planner-booking.e2e-spec.ts. Create BOOKED leave overlapping the request range, assert GET /api/workshop/planner returns employeesAway, and assert the existing planner booking behavior remains successful when a mechanic is away.

Run:
~~~powershell
npm run test:e2e --workspace=core-api -- --runInBand workshop-planner-booking.e2e-spec.ts
~~~

- [ ] Step 6: Commit.
~~~powershell
git add apps/core-api/src/workshop/dto/workshop-planner.dto.ts apps/core-api/src/workshop/workshop-planner.service.ts apps/core-api/src/workshop/workshop-planner.service.spec.ts apps/core-api/test/workshop-planner-booking.e2e-spec.ts
git commit -m "feat(workshop): expose mechanic leave in planner response"
~~~

### Task 2: Regenerate contracts and add typed HR/planner keys

Files:
- Modify apps/core-api/openapi/openapi.json
- Create apps/core-web/src/api/hr.ts and apps/core-web/src/api/hr.test.tsx
- Modify apps/core-web/src/api/workshop.ts
- Modify apps/core-web/src/features/realtime/dashboard-entity-map.ts and its test
- Modify apps/core-web/src/api/generated/openapi.ts

- [ ] Step 1: Regenerate the contracts.
~~~powershell
npm --prefix apps/core-api run openapi:generate
npm --prefix apps/core-web run api:types:generate
~~~
Expected: PlannerEmployeeAwayDto and employeesAway are present in both generated artifacts.

- [ ] Step 2: Write failing hook tests.

Render useHrMeClock and usePunchClock with a QueryClient and mocked fetchWithAuth. Assert:
~~~ts
expect(fetchWithAuth).toHaveBeenCalledWith('/api/hr/me/clock');
expect(fetchWithAuth).toHaveBeenCalledWith('/api/hr/me/clock', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'CLOCK_IN' }),
});
~~~
Add a mutation test proving success invalidates hrKeys.all.

- [ ] Step 3: Run the hook test and verify RED.
~~~powershell
npm test --workspace=core-web -- src/api/hr.test.tsx
~~~

- [ ] Step 4: Implement hr.ts.

Define one factory:
~~~ts
export const hrKeys = {
  all: ['hr'] as const,
  me: () => [...hrKeys.all, 'me'] as const,
  clock: () => [...hrKeys.all, 'clock'] as const,
  attendance: (from: string, to: string, employeeId?: string) =>
    [...hrKeys.all, 'attendance', from, to, employeeId ?? 'all'] as const,
  myLeave: (year: number) => [...hrKeys.all, 'me-leave', year] as const,
  leave: (from: string, to: string, employeeId?: string) =>
    [...hrKeys.all, 'leave', from, to, employeeId ?? 'all'] as const,
};
~~~
Add typed hooks for me, me/clock, attendance list and manager punch, my leave/create, team leave/create-on-behalf, cancel/update leave, and leave-balance patch. Use generated schema types, fetchWithAuth, and HTTP errors carrying status for 403 handling. Mutations invalidate hrKeys.all; leave mutations also invalidate employeeKeys.all and workshopKeys.planner().

In api/workshop.ts add planner: () => [...workshopKeys.all, 'planner'] as const.

- [ ] Step 5: Map realtime events.
Use hrKeys.all for ATTENDANCE_EVENT. Use hrKeys.all and workshopKeys.planner() for LEAVE_REQUEST. Update dashboard-entity-map.test.ts to assert these exact targets.

- [ ] Step 6: Run tests and type drift check.
~~~powershell
npm test --workspace=core-web -- src/api/hr.test.tsx src/features/realtime/dashboard-entity-map.test.ts
npm run api:types:check --workspace=core-web
~~~

- [ ] Step 7: Commit.
~~~powershell
git add apps/core-api/openapi/openapi.json apps/core-web/src/api/generated/openapi.ts apps/core-web/src/api/hr.ts apps/core-web/src/api/hr.test.tsx apps/core-web/src/api/workshop.ts apps/core-web/src/features/realtime/dashboard-entity-map.ts apps/core-web/src/features/realtime/dashboard-entity-map.test.ts
git commit -m "feat(hr): add typed HR queries and planner invalidation keys"
~~~

### Task 3: Add shared status, shadcn primitives, and AttendancePunchBar

Files:
- Create apps/core-web/src/components/ui/alert.tsx and skeleton.tsx
- Modify apps/core-web/src/components/status/StatusBadge.tsx
- Create apps/core-web/src/components/hr/AttendancePunchBar.tsx and test

- [ ] Step 1: Write failing tests for state enablement.
~~~tsx
it('enables only Come to work while clocked out', () => {
  render(<AttendancePunchBar state="CLOCKED_OUT" onPunch={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Come to work' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Doctor' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Go home' })).toBeDisabled();
});

it('enables Go home while at the doctor', () => {
  render(<AttendancePunchBar state="AT_DOCTOR" onPunch={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Come to work' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Go home' })).toBeEnabled();
});
~~~
Also cover pending state, compact sizing, and current-state badge.

- [ ] Step 2: Run the test and verify RED.
~~~powershell
npm test --workspace=core-web -- src/components/hr/AttendancePunchBar.test.tsx
~~~

- [ ] Step 3: Implement the primitives and bar.

Use the existing shadcn conventions for Alert/AlertTitle/AlertDescription and Skeleton. Add status styles:
~~~ts
CLOCKED_IN: 'border-emerald-200 bg-emerald-100 text-emerald-700',
CLOCKED_OUT: 'border-slate-200 bg-slate-100 text-slate-700',
AT_DOCTOR: 'border-sky-200 bg-sky-100 text-sky-700',
BOOKED: 'border-emerald-200 bg-emerald-100 text-emerald-700',
~~~

Define props with generated union types:
~~~ts
type AttendancePunchBarProps = {
  state: components['schemas']['AttendanceState'];
  pending?: boolean;
  size?: 'default' | 'compact';
  onPunch: (type: components['schemas']['AttendanceEventType']) => void;
};
~~~
Keep all four buttons visible; enable CLOCK_IN for CLOCKED_OUT/PAUSED/AT_DOCTOR, PAUSE and DOCTOR for CLOCKED_IN, and CLOCK_OUT for CLOCKED_IN/PAUSED/AT_DOCTOR. Use LogIn, Pause, Stethoscope, and LogOut. Do not use job pause terminology.

- [ ] Step 4: Run the test and verify GREEN.
~~~powershell
npm test --workspace=core-web -- src/components/hr/AttendancePunchBar.test.tsx
~~~

- [ ] Step 5: Commit.
~~~powershell
git add apps/core-web/src/components/ui/alert.tsx apps/core-web/src/components/ui/skeleton.tsx apps/core-web/src/components/status/StatusBadge.tsx apps/core-web/src/components/hr/AttendancePunchBar.tsx apps/core-web/src/components/hr/AttendancePunchBar.test.tsx
git commit -m "feat(hr): add shared attendance punch bar"
~~~

### Task 4: Integrate the compact bar in the mechanic queue

Files:
- Modify apps/core-web/src/pages/mechanic/MechanicQueuePage.tsx
- Test apps/core-web/src/pages/mechanic/MechanicQueuePage.test.tsx

- [ ] Step 1: Write failing integration tests.

Mock useHrMeClock and usePunchClock. Assert a linked employee renders compact buttons and clicking Come to work calls mutate with { type: 'CLOCK_IN' }. Return an error with HTTP status 403 and assert no punch button is rendered. Keep the existing refresh and queue controls asserted.

- [ ] Step 2: Run and verify RED.
~~~powershell
npm test --workspace=core-web -- src/pages/mechanic/MechanicQueuePage.test.tsx
~~~

- [ ] Step 3: Wire the hooks.

Render AttendancePunchBar size compact beside Refresh only when useHrMeClock has data. If getErrorStatus(clockQuery.error) is 403, render nothing and do not toast. Keep other failures in existing page error handling. The mutation hook owns hrKeys invalidation.

- [ ] Step 4: Run and verify GREEN.
~~~powershell
npm test --workspace=core-web -- src/pages/mechanic/MechanicQueuePage.test.tsx
~~~

- [ ] Step 5: Commit.
~~~powershell
git add apps/core-web/src/pages/mechanic/MechanicQueuePage.tsx apps/core-web/src/pages/mechanic/MechanicQueuePage.test.tsx
git commit -m "feat(hr): add mechanic queue clock controls"
~~~

### Task 5: Extract and extend one shared employee roster

Files:
- Create apps/core-web/src/components/hr/EmployeeTable.tsx and test
- Modify apps/core-web/src/components/settings/EmployeeSettingsTab.tsx and test

- [ ] Step 1: Write failing roster tests.

Use employee fixtures with hiredOn, annualLeaveDays, remainingLeaveDays, and userId. Assert Hire date, Leave days, Remaining, and Login columns render. Assert SALES cannot edit hire date, allowance, or carryover; OWNER/ADMIN can. Assert the Settings wrapper still renders + Employee and the same table.

- [ ] Step 2: Run and verify RED.
~~~powershell
npm test --workspace=core-web -- src/components/hr/EmployeeTable.test.tsx src/components/settings/EmployeeSettingsTab.test.tsx
~~~

- [ ] Step 3: Extract the current table.

Move search across all visible fields, sorting, pagination, inline existing fields, create form, and delete/deactivate behavior into EmployeeTable. Keep employeeKeys and useEmployees. Add date input for hiredOn, integer input for annualLeaveDays 0–365, read-only remainingLeaveDays, and linked User.id display. OWNER/ADMIN sends the HR fields on blur/select; SALES sees read-only values. The employee Sheet saves current-year carryover through usePatchLeaveBalance. Keep EmployeeSettingsTab as a thin consumer so Settings and HR cannot diverge.

- [ ] Step 4: Run and verify GREEN.
~~~powershell
npm test --workspace=core-web -- src/components/hr/EmployeeTable.test.tsx src/components/settings/EmployeeSettingsTab.test.tsx
~~~

- [ ] Step 5: Commit.
~~~powershell
git add apps/core-web/src/components/hr/EmployeeTable.tsx apps/core-web/src/components/hr/EmployeeTable.test.tsx apps/core-web/src/components/settings/EmployeeSettingsTab.tsx apps/core-web/src/components/settings/EmployeeSettingsTab.test.tsx
git commit -m "feat(hr): share employee roster with HR pages"
~~~

### Task 6: Add HR layout, routes, sidebar, and employee page

Files:
- Create apps/core-web/src/pages/hr/HrLayout.tsx/test
- Create apps/core-web/src/pages/hr/HrEmployeesPage.tsx/test
- Modify apps/core-web/src/App.tsx and components/navigation/AppSidebar.tsx
- Modify apps/core-web/src/pages/SettingsPage.tsx and test

- [ ] Step 1: Write failing route tests.

Assert HrLayout tab links target /hr/employees, /hr/clock, and /hr/leave; nested content renders through Outlet; /hr redirects to /hr/employees; sidebar exposes one HR link active for /hr; Settings still exposes Employees.

- [ ] Step 2: Run and verify RED.
~~~powershell
npm test --workspace=core-web -- src/pages/hr/HrLayout.test.tsx src/pages/hr/HrEmployeesPage.test.tsx src/pages/SettingsPage.test.tsx
~~~

- [ ] Step 3: Implement route integration.
~~~tsx
<Route path="/hr" element={<HrLayout />}>
  <Route index element={<Navigate to="employees" replace />} />
  <Route path="employees" element={<HrEmployeesPage />} />
  <Route path="clock" element={<HrClockPage />} />
  <Route path="leave" element={<HrLeavePage />} />
</Route>
~~~
Use the existing office shell, an HR sidebar entry after Workshop Board with Users, and a page header with the required title/subtitle and top-right + Employee action. Do not expose the item in the TECH mechanic shell.

- [ ] Step 4: Run and verify GREEN.
~~~powershell
npm test --workspace=core-web -- src/pages/hr/HrLayout.test.tsx src/pages/hr/HrEmployeesPage.test.tsx src/pages/SettingsPage.test.tsx
~~~

- [ ] Step 5: Commit.
~~~powershell
git add apps/core-web/src/pages/hr apps/core-web/src/App.tsx apps/core-web/src/components/navigation/AppSidebar.tsx apps/core-web/src/pages/SettingsPage.tsx apps/core-web/src/pages/SettingsPage.test.tsx
git commit -m "feat(hr): add HR routes and employee page"
~~~

### Task 7: Implement the HR clock page

Files:
- Create apps/core-web/src/pages/hr/HrClockPage.tsx/test

- [ ] Step 1: Write failing page tests.

Mock a linked employee, CLOCKED_IN state, and ordered todayEvents. Assert punch buttons, tenant-local event times, and timeline labels. Assert OWNER/ADMIN receives employee selector and attendance table controls while SALES does not. Assert a 403 renders No employee record linked with a link to HR Employees or Settings Team.

- [ ] Step 2: Run and verify RED.
~~~powershell
npm test --workspace=core-web -- src/pages/hr/HrClockPage.test.tsx
~~~

- [ ] Step 3: Implement the page.

Use useHrMe, useHrMeClock, usePunchClock, usePunchEmployeeClock, useHrAttendance, and useEmployees. Self uses /me/clock; another employee uses /attendance with employeeId and type only. Build selected-day YYYY-MM-DD range queries, format events with date-fns, show Skeleton during load, and preserve the documented 403 state.

- [ ] Step 4: Run and verify GREEN.
~~~powershell
npm test --workspace=core-web -- src/pages/hr/HrClockPage.test.tsx
~~~

- [ ] Step 5: Commit.
~~~powershell
git add apps/core-web/src/pages/hr/HrClockPage.tsx apps/core-web/src/pages/hr/HrClockPage.test.tsx
git commit -m "feat(hr): add attendance clock page"
~~~

### Task 8: Implement leave booking, list, cancellation, and calendar

Files:
- Create components/hr/LeaveBookingSheet.tsx/test
- Create components/hr/TeamLeaveMonthGrid.tsx/test
- Create pages/hr/HrLeavePage.tsx/test

- [ ] Step 1: Write failing tests.

Assert self sheet submits startOn/endOn/note to the self mutation; manager sheet adds employeeId and uses the manager mutation; a 409 keeps the Sheet open and shows the backend message. Assert BOOKED cells use StatusBadge, empty cells are clickable only for OWNER/ADMIN, and SALES cannot book from the grid.

- [ ] Step 2: Run and verify RED.
~~~powershell
npm test --workspace=core-web -- src/components/hr/LeaveBookingSheet.test.tsx src/components/hr/TeamLeaveMonthGrid.test.tsx src/pages/hr/HrLeavePage.test.tsx
~~~

- [ ] Step 3: Implement LeaveBookingSheet.

Use Sheet primitives and explicit start/end/note inputs. Lock employee to self except OWNER/ADMIN. Use useCreateMyLeave or useCreateEmployeeLeave, keep the Sheet open after 400/409 errors, and toast the HTTP message. Do not add a client-side preview API.

- [ ] Step 4: Implement TeamLeaveMonthGrid and HrLeavePage.

Build a CSS grid from the tenant-local month and employees. Render BOOKED ranges as StatusBadge cells and send empty-cell selection to the page. Show Remaining: n days and + Leave, own bookings in a DataTable with daysCharged, and right-click cancellation only where allowed. Use useMyLeave, useTeamLeave, useCancelLeave, and the HR mutation invalidation rules. Render the team grid for OWNER/ADMIN/SALES and manager booking only for OWNER/ADMIN.

- [ ] Step 5: Run and verify GREEN.
~~~powershell
npm test --workspace=core-web -- src/components/hr/LeaveBookingSheet.test.tsx src/components/hr/TeamLeaveMonthGrid.test.tsx src/pages/hr/HrLeavePage.test.tsx
~~~

- [ ] Step 6: Commit.
~~~powershell
git add apps/core-web/src/components/hr/LeaveBookingSheet.tsx apps/core-web/src/components/hr/LeaveBookingSheet.test.tsx apps/core-web/src/components/hr/TeamLeaveMonthGrid.tsx apps/core-web/src/components/hr/TeamLeaveMonthGrid.test.tsx apps/core-web/src/pages/hr/HrLeavePage.tsx apps/core-web/src/pages/hr/HrLeavePage.test.tsx
git commit -m "feat(hr): add leave booking and team calendar"
~~~

### Task 9: Add reusable MechanicAwayAlert without creating the planner page

Files:
- Create apps/core-web/src/components/hr/MechanicAwayAlert.tsx/test

- [ ] Step 1: Write failing tests.
~~~tsx
it('renders an advisory warning for booked mechanic leave', () => {
  render(
    <MechanicAwayAlert
      mechanicName="Ada Lovelace"
      away={{
        employeeId: 'employee-1',
        name: 'Ada Lovelace',
        startOn: '2026-08-24',
        endOn: '2026-08-26',
        leaveId: 'leave-1',
      }}
    />,
  );
  expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
  expect(screen.getByText(/booking is still allowed/i)).toBeInTheDocument();
});

it('renders nothing without an away record', () => {
  const { container } = render(<MechanicAwayAlert mechanicName="Ada Lovelace" />);
  expect(container).toBeEmptyDOMElement();
});
~~~

- [ ] Step 2: Run and verify RED.
~~~powershell
npm test --workspace=core-web -- src/components/hr/MechanicAwayAlert.test.tsx
~~~

- [ ] Step 3: Implement the component.

Accept generated PlannerEmployeeAwayDto and optional mechanicName. Render the shared Alert with amber styling, employee name, inclusive date range, and text that leave is advisory and bay booking remains allowed. Do not create or import /workshop/planner; AUT-177 owns that page and it is absent from main.

- [ ] Step 4: Run and verify GREEN.
~~~powershell
npm test --workspace=core-web -- src/components/hr/MechanicAwayAlert.test.tsx
~~~

- [ ] Step 5: Commit.
~~~powershell
git add apps/core-web/src/components/hr/MechanicAwayAlert.tsx apps/core-web/src/components/hr/MechanicAwayAlert.test.tsx
git commit -m "feat(workshop): add reusable mechanic leave warning"
~~~

### Task 10: Full verification and scope review

- [ ] Step 1: Run focused frontend tests.
~~~powershell
npm test --workspace=core-web -- src/api/hr.test.tsx src/components/hr src/pages/hr src/pages/mechanic/MechanicQueuePage.test.tsx src/features/realtime/dashboard-entity-map.test.ts
~~~

- [ ] Step 2: Run backend planner and HR regressions.
~~~powershell
npm test --workspace=core-api -- --ci --runInBand src/workshop/workshop-planner.service.spec.ts src/hr/hr-controller.spec.ts
~~~

- [ ] Step 3: Run lint, builds, and contract drift checks.
~~~powershell
npm run lint --workspace=core-api
npm run lint --workspace=core-web
npm run build --workspace=core-api
npm run build --workspace=core-web
npm run api:types:check --workspace=core-web
~~~

- [ ] Step 4: Run complete unit suites.
~~~powershell
npm test --workspace=core-api -- --ci --runInBand
npm test --workspace=core-web
~~~

- [ ] Step 5: Inspect scope and diff.
~~~powershell
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short
~~~
Confirm there is no /workshop/planner route/page, no LaborEntry or WorkshopHoliday reuse, no inline HR/planner realtime keys, and no generated contract drift.

### Task 11: Push and create the linked PR

- [ ] Step 1: Review history and status.
~~~powershell
git log --oneline --decorate origin/main..HEAD
git status --short
~~~

- [ ] Step 2: Push.
~~~powershell
git push -u origin feature/aut-183-aut-184-hr-ui
~~~

- [ ] Step 3: Create one PR using gh CLI.
~~~powershell
gh pr create --title "feat(hr): add employee, clock, leave, and mechanic HR UI" --body "## Summary

- Implements AUT-183: HR employees, clock, and leave pages.
- Implements AUT-184: mechanic clock bar, planner employeesAway contract, reusable mechanic-away alert, and realtime invalidation.
- Keeps the planner page owned by AUT-177; the reusable alert is intentionally unmounted because no planner page exists on main.

## Verification

- Focused HR, mechanic, planner, and realtime tests
- Backend/frontend lint and builds
- OpenAPI/frontend generated type drift check

Fixes AUT-183
Fixes AUT-184"
~~~

- [ ] Step 4: Verify the PR body contains both AUT-183 and AUT-184 and report the URL.

---

## Self-review

Coverage:
- Employee fields, role access, shared Settings roster: Tasks 5–6.
- HR routes, clock timeline, manager timesheet: Tasks 6–7.
- Leave sheet, balance, cancellation, and team grid: Task 8.
- Punch bar and mechanic 403 behavior: Tasks 3–4.
- Planner employeesAway contract and no 409: Task 1.
- Reusable advisory alert without AUT-177 page: Task 9.
- Realtime invalidation and generated contracts: Task 2.
- TDD and verification: Tasks 1–10.
- Linked PR: Task 11.

Consistency:
- States are CLOCKED_OUT, CLOCKED_IN, PAUSED, AT_DOCTOR.
- Punch types are CLOCK_IN, PAUSE, DOCTOR, CLOCK_OUT.
- Leave fields are startOn, endOn, daysCharged, and status.
- Realtime uses hrKeys.all and workshopKeys.planner().
- No task creates or mounts /workshop/planner.

