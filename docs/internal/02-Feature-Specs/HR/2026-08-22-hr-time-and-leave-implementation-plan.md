# HR Time and Leave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an HR module: employee hire/leave fields, attendance clock (Come / Pause / Doctor / Home), remaining holiday days, mechanic punch bar, and a planner mechanic-away warning.

**Architecture:** Reuse `Employee`. Attendance is append-only `AttendanceEvent` (not `LaborEntry`). Leave is `LeaveRequest` + yearly `EmployeeLeaveBalance` (not `WorkshopHoliday`). Workday math reads workshop hours/holidays. Keep `/api/employees` for roster; clock/leave under `/api/hr`. TECH only on `/api/hr/me/*`.

**Tech Stack:** Prisma / PostgreSQL, NestJS, class-validator, Jest, React 19, Vitest, TanStack Query, Tailwind v4, shadcn Tabs/Sheet/Button/DataTable. No FullCalendar. No payroll.

**Spec:** `docs/internal/02-Feature-Specs/HR/2026-08-22-hr-time-and-leave.md`

**ADR:** `docs/internal/01-ADR/2026-08-22-hr-time-and-leave.md`

**Component spec:** `docs/internal/03-Component-Specs/hr/HrClockPage.md`

**Linear:** [HR Time and Leave](https://linear.app/auto-core-platform/project/hr-time-and-leave-7e0299d12e1f) — AUT-179 approval, AUT-180 schema, AUT-181 clock, AUT-182 leave, AUT-183 HR UI, AUT-184 mechanic/planner, AUT-185 Mintlify.

**Do not:** store leave as `WorkshopHoliday`. Punch HR into `LaborEntry`. Call OpenHolidays from HR. Require clock-in to start a job. Add a PIN kiosk. Compare `Employee.user_id` to `session.userId`. Load `WorkshopSettings` from SystemPrisma.

---

## File map

### Prisma / cleanup / allowlists

- Modify: `apps/core-api/prisma/schema.prisma` — Employee columns; enums; `EmployeeLeaveBalance`, `LeaveRequest`, `AttendanceEvent`; Tenant relations
- Create: `apps/core-api/prisma/migrations/20260822140000_hr_time_and_leave/migration.sql`
- Create: `apps/core-api/src/prisma/hr-schema.spec.ts`
- Modify: `apps/core-api/test/tenant-test-utils.ts` — delete attendance, leave requests, balances **before** `employee.deleteMany`
- Modify: `apps/core-api/src/prisma/prisma-audit.extension.ts` — add `EmployeeLeaveBalance`, `LeaveRequest` to `AUDITED_MODELS` (not `AttendanceEvent` — punches are the audit)
- Modify: `apps/core-api/src/prisma/prisma-audit.extension.spec.ts`
- Modify: `apps/core-api/src/prisma/system-prisma.types.ts` — add `attendanceEvent` with comment "HrAttendanceSchedulerService nightly close only"
- Modify: `apps/core-api/src/prisma/system-prisma.service.ts` — getter + `$transaction` pick
- Modify: `apps/core-api/src/prisma/system-prisma.service.spec.ts`
- Modify: `docs/internal/05-Runbooks/system-prisma-allowlist.md`
- Modify: `docs/deletion-policy.md`
- Modify: `tools/tenant-restore/purge-tenant-data.sql` and `verify-tenant-schema.sql`

### Backend HR module

- Create: `apps/core-api/src/hr/hr.module.ts`
- Create: `apps/core-api/src/hr/hr.controller.ts`
- Create: `apps/core-api/src/hr/hr-identity.service.ts`
- Create: `apps/core-api/src/hr/hr-identity.service.spec.ts`
- Create: `apps/core-api/src/hr/hr-attendance.service.ts`
- Create: `apps/core-api/src/hr/hr-attendance.service.spec.ts`
- Create: `apps/core-api/src/hr/hr-attendance-scheduler.service.ts`
- Create: `apps/core-api/src/hr/hr-attendance-scheduler.service.spec.ts`
- Create: `apps/core-api/src/hr/hr-workday.service.ts`
- Create: `apps/core-api/src/hr/hr-workday.service.spec.ts`
- Create: `apps/core-api/src/hr/hr-leave.service.ts`
- Create: `apps/core-api/src/hr/hr-leave.service.spec.ts`
- Create: `apps/core-api/src/hr/dto/hr-clock.dto.ts`
- Create: `apps/core-api/src/hr/dto/hr-leave.dto.ts`
- Create: `apps/core-api/src/hr/dto/hr-attendance.dto.ts`
- Modify: `apps/core-api/src/app.module.ts` — import `HrModule`
- Modify: `apps/core-api/src/employee/dto/employee.dto.ts` — `hiredOn`, `annualLeaveDays`, `remainingLeaveDays`
- Modify: `apps/core-api/src/employee/employee.service.ts` — persist + remaining batch
- Modify: `apps/core-api/src/employee/employee.service.spec.ts` (create if missing tests for new fields)
- Modify: `apps/core-api/src/dashboard-realtime/dashboard-events.types.ts` — `ATTENDANCE_EVENT`, `LEAVE_REQUEST`
- Modify: `apps/core-api/src/prisma/prisma-dashboard-realtime.extension.ts`
- Modify: `apps/core-api/src/workshop/dto/workshop-planner.dto.ts` — `employeesAway`
- Modify: `apps/core-api/src/workshop/workshop-planner.service.ts` — populate away list
- Modify: `apps/core-api/src/workshop/workshop-planner.service.spec.ts`
- Create: `apps/core-api/test/hr-attendance.e2e-spec.ts`
- Create: `apps/core-api/test/hr-leave.e2e-spec.ts`

### Frontend

- Create: `apps/core-web/src/api/hr.ts`
- Modify: `apps/core-web/src/api/employees.ts` — types pick up generated DTO fields after regen
- Modify: `apps/core-web/src/App.tsx` — `/hr/employees`, `/hr/clock`, `/hr/leave`
- Modify: `apps/core-web/src/components/navigation/AppSidebar.tsx`
- Create: `apps/core-web/src/pages/hr/HrLayout.tsx`
- Create: `apps/core-web/src/pages/hr/HrEmployeesPage.tsx`
- Create: `apps/core-web/src/pages/hr/HrClockPage.tsx`
- Create: `apps/core-web/src/pages/hr/HrLeavePage.tsx`
- Create: `apps/core-web/src/components/hr/AttendancePunchBar.tsx`
- Create: `apps/core-web/src/components/hr/AttendancePunchBar.test.tsx`
- Create: `apps/core-web/src/components/hr/LeaveBookingSheet.tsx`
- Create: `apps/core-web/src/components/hr/TeamLeaveMonthGrid.tsx`
- Modify: `apps/core-web/src/components/settings/EmployeeSettingsTab.tsx` — hire date, leave days, remaining
- Modify: `apps/core-web/src/pages/mechanic/MechanicQueuePage.tsx`
- Modify: `apps/core-web/src/pages/mechanic/MechanicQueuePage.test.tsx`
- Modify: `apps/core-web/src/components/status/StatusBadge.tsx` — `CLOCKED_IN`, `CLOCKED_OUT`, `AT_DOCTOR`, `BOOKED`
- Modify: `apps/core-web/src/features/realtime/types.ts` + `dashboard-entity-map.ts` + tests
- Regen: `apps/core-api/openapi/openapi.json` then `apps/core-web/src/api/generated/openapi.ts`

### Docs (after UI exists)

- Create: `hr.mdx` (Mintlify) — employees, clock, leave in workshop English
- Modify: `settings/employees.mdx` — hire date, remaining, link to HR
- Modify: `docs.json` — HR page in Guides
- Modify: `workflows/workshop-board.mdx` — one sentence: leave is HR, not the board
- Modify: `agents.md` Core Modules table when shipping (not this spec PR)

---

### Task 1: Prisma schema + migration + cleanup

**Files:** schema, migration, `hr-schema.spec.ts`, `tenant-test-utils.ts`, audit, system-prisma, deletion policy, restore SQL

- [ ] **Step 1: Write the failing schema contract test**

Create `apps/core-api/src/prisma/hr-schema.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('HR Prisma schema', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');

  it('defines attendance, leave, and employee HR columns', () => {
    expect(schema).toContain('enum AttendanceEventType');
    expect(schema).toContain('enum AttendanceEventSource');
    expect(schema).toContain('enum LeaveRequestStatus');
    expect(schema).toContain('model EmployeeLeaveBalance');
    expect(schema).toContain('model LeaveRequest');
    expect(schema).toContain('model AttendanceEvent');
    expect(schema).toContain('hired_on');
    expect(schema).toContain('annual_leave_days');
    expect(schema).toContain('@@map("employee_leave_balances")');
    expect(schema).toContain('@@map("leave_requests")');
    expect(schema).toContain('@@map("attendance_events")');
    expect(schema).toContain('@@unique([tenant_id, employee_id, year])');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```
npm --prefix apps/core-api test -- src/prisma/hr-schema.spec.ts
```

Expected: FAIL (models missing).

- [ ] **Step 3: Add models to `schema.prisma`**

On `Tenant`, add:

```prisma
employeeLeaveBalances EmployeeLeaveBalance[]
leaveRequests         LeaveRequest[]
attendanceEvents      AttendanceEvent[]
```

On `Employee`, add the fields and relations from the feature spec (`hired_on`, `annual_leave_days`, three relations). Paste the three models and three enums **exactly** as in `docs/internal/02-Feature-Specs/HR/2026-08-22-hr-time-and-leave.md` (composite `@@unique([tenant_id, id])`, tenant-safe FKs `fields: [tenant_id, employee_id], references: [tenant_id, id]`).

Do **not** add `updatedAt` on `AttendanceEvent`. Do **not** put leave columns on `WorkshopHoliday`.

- [ ] **Step 4: Migration** `apps/core-api/prisma/migrations/20260822140000_hr_time_and_leave/migration.sql`

```
npm --prefix apps/core-api exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script
```

SQL must: create enums; add `hired_on` date null and `annual_leave_days` int default 25; create three tables with tenant FKs and composite employee FKs.

- [ ] **Step 5: Cleanup before `employee.deleteMany`**

In `cleanupTestTenantGraph`:

```ts
await tenantPrisma.attendanceEvent.deleteMany({});
await tenantPrisma.leaveRequest.deleteMany({});
await tenantPrisma.employeeLeaveBalance.deleteMany({});
```

Place these immediately **before** `await tenantPrisma.employee.deleteMany({})`.

- [ ] **Step 6: Audit, SystemPrisma, deletion, restore**

- `AUDITED_MODELS`: add `EmployeeLeaveBalance`, `LeaveRequest`. Do **not** add `AttendanceEvent`.
- `SYSTEM_PRISMA_MODEL_DELEGATES`: add `'attendanceEvent'` with comment "HrAttendanceSchedulerService nightly close only". Update `createSystemPrismaTransactionClient`, add getter on `SystemPrismaService`, extend the fake client in the spec. Update `docs/internal/05-Runbooks/system-prisma-allowlist.md` Allowed Delegates + Allowed Callers (`HrAttendanceSchedulerService` → `attendanceEvent`).
- `docs/deletion-policy.md`: rows from the feature spec Deletion Policy Impact. Employee hard delete `409` if attendance, leave, or balance rows exist.
- Restore SQL: add `attendance_events`, `leave_requests`, `employee_leave_balances` to table lists and FK checks (purge **before** `employees`).
- Auto-close inserts must copy `tenant_id` from the latest event row.

- [ ] **Step 7: Re-run schema test — expect PASS. Commit.**

```
git commit -m "feat(hr): add attendance, leave, and employee HR columns"
```

---

### Task 2: Employee DTO fields + remaining days

**Files:** `employee.dto.ts`, `employee.service.ts`, unit tests

- [ ] **Step 1: Failing unit test** in `apps/core-api/src/employee/employee.service.spec.ts` (create the file if absent)

```ts
it('maps hiredOn, annualLeaveDays, and remainingLeaveDays', async () => {
  prisma.employee.findMany.mockResolvedValue([
    {
      id: 'e1',
      name: 'Ada',
      role: 'MECHANIC',
      is_active: true,
      sort_order: 0,
      user_id: null,
      mother_language_code: null,
      hired_on: new Date('2024-03-01'),
      annual_leave_days: 25,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  prisma.employee.count.mockResolvedValue(1);
  prisma.employeeLeaveBalance.findMany.mockResolvedValue([
    { employee_id: 'e1', allowance_days: 25, carryover_days: 2 },
  ]);
  prisma.leaveRequest.groupBy.mockResolvedValue([
    { employee_id: 'e1', _sum: { days_charged: 5 } },
  ]);

  const result = await service.findAll({});
  expect(result.data[0].hiredOn).toBe('2024-03-01');
  expect(result.data[0].annualLeaveDays).toBe(25);
  expect(result.data[0].remainingLeaveDays).toBe(22);
});
```

- [ ] **Step 2: Run — expect FAIL** (fields missing)

- [ ] **Step 3: Implement**

On `CreateEmployeeDto` / `UpdateEmployeeDto` / `EmployeeResponseDto`:

```ts
@ApiPropertyOptional({ type: String, format: 'date', nullable: true })
@IsOptional()
@IsDateString()
hiredOn?: string | null;

@ApiPropertyOptional({ minimum: 0, maximum: 365 })
@IsOptional()
@IsInt()
@Min(0)
@Max(365)
annualLeaveDays?: number;
```

Response required:

```ts
@ApiPropertyOptional({ type: String, format: 'date', nullable: true })
hiredOn!: string | null;

@ApiProperty()
annualLeaveDays!: number;

@ApiProperty()
remainingLeaveDays!: number;
```

`mapEmployee` plus a `attachRemaining(employees)` that:

1. Reads tenant timezone from `workshopSettings` (default `Europe/Vienna`)
2. Current year via `formatLocalDate(new Date(), timezone).slice(0, 4)`
3. `employeeLeaveBalance.findMany` for those ids + year
4. `leaveRequest.groupBy({ by: ['employee_id'], where: { status: 'BOOKED', employee_id: { in: ids }, start_on: { gte: `${year}-01-01`, lte: `${year}-12-31` } }, _sum: { days_charged: true } })`
5. remaining = `(balance?.allowance_days ?? employee.annual_leave_days) + (balance?.carryover_days ?? 0) - (sum ?? 0)`

Persist `hired_on` / `annual_leave_days` on create/update. Default `annual_leave_days` to 25.

If the payload includes `hiredOn` or `annualLeaveDays`, `assertTenantAdminAccess()` (OWNER/ADMIN). SALES may still PATCH name/role/active/userId. If `annualLeaveDays` is set and a current local-year balance row exists, update that row's `allowance_days` in the same transaction. Do **not** upsert a balance from `findAll` / `findOne`.

- [ ] **Step 4: Run test — PASS. Commit.**

```
git commit -m "feat(hr): expose hire date and remaining leave on employees"
```

---

### Task 3: `HrWorkdayService`

**Files:** `hr-workday.service.ts`, spec

- [ ] **Step 1: Failing tests**

```ts
describe('countChargeableDays', () => {
  it('skips closed Sunday', () => {
    const hours = weekdaysMonFri(); // 1-5 open, 6-7 closed
    expect(
      service.countChargeableDays('2026-08-24', '2026-08-30', 'Europe/Vienna', hours, []),
    ).toBe(5); // Mon-Fri
  });

  it('skips closed WorkshopHoliday', () => {
    const hours = weekdaysMonFri();
    const holidays = [{ observed_on: new Date('2026-08-26'), repeats_annually: false, is_closed: true }];
    expect(
      service.countChargeableDays('2026-08-24', '2026-08-28', 'Europe/Vienna', hours, holidays),
    ).toBe(4); // Wed 26 skipped
  });

  it('charges a short holiday as 1', () => {
    const hours = weekdaysMonFri();
    const holidays = [{ observed_on: new Date('2026-08-26'), repeats_annually: false, is_closed: false }];
    expect(
      service.countChargeableDays('2026-08-26', '2026-08-26', 'Europe/Vienna', hours, holidays),
    ).toBe(1);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement** using `eachLocalDate` / holiday month-day match already in `apps/core-api/src/workshop/workshop-planner.time.ts` and holiday expansion in `workshop-holiday.service.ts` (import helpers; do not copy OpenHolidays client). Pure function `countChargeableDays(from, to, tz, hours, holidays): number`. Also `loadTenantCalendar(tenantId)` that reads settings + hours + holidays via `PrismaService`.

- [ ] **Step 4: PASS. Commit.**

```
git commit -m "feat(hr): count leave workdays from workshop hours"
```

---

### Task 4: Attendance state machine + `/api/hr/me/clock`

**Files:** identity, attendance service, DTOs, controller, module

- [ ] **Step 1: Failing transition tests** in `hr-attendance.service.spec.ts`

```ts
it('CLOCK_IN from CLOCKED_OUT succeeds', async () => {
  prisma.attendanceEvent.findFirst.mockResolvedValue(null);
  prisma.attendanceEvent.create.mockResolvedValue({
    type: 'CLOCK_IN',
    occurred_at: new Date(),
  });
  await expect(service.punch(employeeId, 'CLOCK_IN', 'SELF')).resolves.toMatchObject({
    state: 'CLOCKED_IN',
  });
});

it('PAUSE while CLOCKED_OUT returns 409', async () => {
  prisma.attendanceEvent.findFirst.mockResolvedValue({ type: 'CLOCK_OUT' });
  await expect(service.punch(employeeId, 'PAUSE', 'SELF')).rejects.toBeInstanceOf(
    ConflictException,
  );
});

it('second CLOCK_IN while CLOCKED_IN returns 409', async () => {
  prisma.attendanceEvent.findFirst.mockResolvedValue({ type: 'CLOCK_IN' });
  await expect(service.punch(employeeId, 'CLOCK_IN', 'SELF')).rejects.toBeInstanceOf(
    ConflictException,
  );
});
```

Legal next types — copy the table from the feature spec into `ALLOWED_NEXT: Record<AttendanceState, AttendanceEventType[]>`.

Also add `hr-identity.service.spec.ts` asserting `findFirst` is called with `user: { OR: [{ firebaseUid: user.userId }, { email: user.email }] }`, not `user_id: user.userId`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`hr-identity.service.ts`:

```ts
async resolveMe(): Promise<{ employeeId: string }> {
  const user = this.tenantContext.getAuthenticatedUser();
  if (!user?.userId) {
    throw new ForbiddenException('No employee record linked to this account');
  }
  const employee = await this.prisma.employee.findFirst({
    where: {
      is_active: true,
      user: {
        OR: [{ firebaseUid: user.userId }, { email: user.email }],
      },
    },
    select: { id: true },
  });
  if (!employee) {
    throw new ForbiddenException('No employee record linked to this account');
  }
  return { employeeId: employee.id };
}
```

`session.userId` is `User.firebaseUid`, not `Employee.user_id`. Do not call `MechanicIdentityService.resolveMechanic()` (requires TECH + MECHANIC).

```ts
assertOwnerAdmin() {
  const role = this.tenantContext.getAuthenticatedUser()?.role;
  if (role !== 'OWNER' && role !== 'ADMIN') {
    throw new ForbiddenException('Tenant admin access is required.');
  }
}
```

`HrController`:

```ts
@Controller('hr')
export class HrController {
  @Get('me')
  @MechanicAccessible()
  me() { return this.identity.getMeProfile(); }

  @Get('me/clock')
  @MechanicAccessible()
  clock() { return this.attendance.getMyClock(); }

  @Post('me/clock')
  @MechanicAccessible()
  punch(@Body() dto: PunchClockDto) {
    return this.attendance.punchMe(dto.type);
  }
}
```

`PunchClockDto`: `{ type: AttendanceEventType }` with `@IsEnum`.

Register `HrModule` in `app.module.ts`. Do not inject `MechanicIdentityService` into HR.

- [ ] **Step 4: PASS unit tests. Commit.**

```
git commit -m "feat(hr): add attendance punch state machine"
```

---

### Task 5: Manager attendance + nightly auto-close

**Files:** `POST /api/hr/attendance`, `GET /api/hr/attendance`, scheduler

- [ ] **Step 1: Failing scheduler test**

```ts
it('inserts CLOCK_OUT AUTO_SHIFT_CLOSE when last event is CLOCK_IN', async () => {
  systemPrisma.attendanceEvent.findMany.mockResolvedValue([
    { id: 'a1', employee_id: 'e1', type: 'CLOCK_IN', occurred_at: yesterdayMorning },
  ]);
  await service.closeOrphanedShifts(new Date('2026-08-22T22:00:00Z'));
  expect(systemPrisma.attendanceEvent.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        employee_id: 'e1',
        type: 'CLOCK_OUT',
        source: 'AUTO_SHIFT_CLOSE',
      }),
    }),
  );
});

it('skips employees whose last event is CLOCK_OUT', async () => {
  systemPrisma.attendanceEvent.findMany.mockResolvedValue([
    { employee_id: 'e1', type: 'CLOCK_OUT', occurred_at: yesterday },
  ]);
  await service.closeOrphanedShifts(new Date());
  expect(systemPrisma.attendanceEvent.create).not.toHaveBeenCalled();
});
```

Query strategy (no N+1): `findMany` orderBy `occurred_at desc`, then keep first row per `employee_id` in JS. Insert `CLOCK_OUT` with `occurred_at` equal to the scheduler's `now` argument (same as `MechanicSchedulerService` closing labor with `ended_at = now()`). **Do not** add `workshopSettings` to SystemPrisma. **Do not** compute local midnight.

Cron: `@Cron('59 23 * * *', { name: 'hr-shift-close' })` — separate name from `mechanic-shift-close`.

Manager `POST /api/hr/attendance`: `assertOwnerAdmin()`, `occurredAt` optional (default `now()`). If provided, must be `>` previous `occurred_at` else `409`. `source = MANAGER`.

`GET /api/hr/attendance?from&to&employeeId`: max 31 days else `400`. OWNER/ADMIN only.

- [ ] **Step 2–4: FAIL, implement, PASS, commit.**

```
git commit -m "feat(hr): add manager attendance list and nightly auto-close"
```

---

### Task 6: Leave APIs

**Files:** `hr-leave.service.ts`, controller routes, e2e

- [ ] **Step 1: Failing tests**

```ts
it('rejects overlapping BOOKED ranges with 409', async () => {
  prisma.leaveRequest.findFirst.mockResolvedValue({ id: 'existing' });
  await expect(
    service.createMine(employeeId, { startOn: '2026-09-01', endOn: '2026-09-03' }),
  ).rejects.toBeInstanceOf(ConflictException);
});

it('rejects when daysCharged exceeds remaining', async () => {
  prisma.leaveRequest.findFirst.mockResolvedValue(null);
  workday.countChargeableDays.mockReturnValue(10);
  prisma.employeeLeaveBalance.findUnique.mockResolvedValue({
    allowance_days: 25,
    carryover_days: 0,
  });
  prisma.leaveRequest.aggregate.mockResolvedValue({ _sum: { days_charged: 20 } });
  await expect(
    service.createMine(employeeId, { startOn: '2026-09-01', endOn: '2026-09-14' }),
  ).rejects.toBeInstanceOf(ConflictException);
});

it('rejects a range that spans two years with 400', async () => {
  await expect(
    service.createMine(employeeId, { startOn: '2026-12-28', endOn: '2027-01-02' }),
  ).rejects.toBeInstanceOf(BadRequestException);
});

it('cancel BOOKED excludes those days from remaining', async () => {
  prisma.leaveRequest.findFirst.mockResolvedValue({
    id: 'l1',
    status: 'BOOKED',
    employee_id: employeeId,
    start_on: futureDate,
  });
  prisma.leaveRequest.update.mockResolvedValue({ status: 'CANCELLED' });
  await service.cancel(employeeId, 'l1', { isAdmin: false });
  expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { status: 'CANCELLED' } }),
  );
});
```

Overlap predicate: `status = BOOKED AND start_on <= endOn AND end_on >= startOn AND id != self`.

Ensure year: `startOn.slice(0, 4) === endOn.slice(0, 4)`.

Upsert balance on first `GET /me/leave` or first create: `allowance_days = employee.annual_leave_days`, `carryover_days = 0`.

`POST /api/hr/leave` (OWNER/ADMIN): `{ employeeId, startOn, endOn, note? }` — same overlap/remaining/year rules as `createMine`.

`POST /api/hr/leave/:id/cancel`: employee may cancel own if `start_on >= today` (tenant tz); OWNER/ADMIN any.

`PATCH /api/hr/leave/:id`: OWNER/ADMIN, recompute `days_charged`, re-check overlap + remaining excluding this row. Same year-span `400` as create.

`PATCH /api/hr/employees/:id/leave-balance`: OWNER/ADMIN upsert. If `year` is the current local year and `allowanceDays` is set, also write `Employee.annual_leave_days`.

- [ ] **Step 2–4: FAIL, implement, PASS.**

- [ ] **Step 5: E2E** `apps/core-api/test/hr-leave.e2e-spec.ts` — create employee+user, book 2 days, remaining drops, cancel restores; OWNER/ADMIN `POST /api/hr/leave` for another employee; TECH 403 on `GET /api/hr/leave`. `apps/core-api/test/hr-attendance.e2e-spec.ts` — punch in/out; illegal pause 409; TECH 403 on `GET /api/hr/attendance`. Identity e2e: linked employee punches via firebase UID, not Postgres `user_id` in the JWT. Also: after `GET /me/leave` upserts a balance, `PATCH annualLeaveDays` to 30 changes remaining; SALES `PATCH annualLeaveDays` → 403; SALES `PATCH` name → 200; hard delete with a balance row → 409.

```
git commit -m "feat(hr): add leave booking, remaining days, and cancel"
```

---

### Task 7: OpenAPI + frontend types + `hrKeys`

- [ ] **Step 1:** `npm --prefix apps/core-api run openapi:generate`
- [ ] **Step 2:** `npm --prefix apps/core-web run api:types:generate`
- [ ] **Step 3:** Create `apps/core-web/src/api/hr.ts` with `hrKeys` **exactly** as in the feature spec, plus `useHrMeClock`, `usePunchClock`, `usePunchEmployeeClock` (`POST /api/hr/attendance`), `useMyLeave`, `useCreateLeave`, `useCreateEmployeeLeave` (`POST /api/hr/leave`), `useCancelLeave`, `useTeamLeave`, `useHrAttendance`, `usePatchLeaveBalance` using `fetchWithAuth` and generated DTO types (`import type`).
- [ ] **Step 4:** Commit both OpenAPI artifacts and `hr.ts`.

```
git commit -m "feat(hr): regenerate OpenAPI and add hr query keys"
```

---

### Task 8: `AttendancePunchBar` + StatusBadge + mechanic queue

**Files:** punch bar, tests, `StatusBadge.tsx`, `MechanicQueuePage.tsx`

- [ ] **Step 1: Failing Vitest** `AttendancePunchBar.test.tsx`

```tsx
it('disables Pause and Doctor when clocked out', () => {
  render(<AttendancePunchBar state="CLOCKED_OUT" onPunch={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Doctor' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Come to work' })).toBeEnabled()
})

it('enables Go home when at the doctor', () => {
  render(<AttendancePunchBar state="AT_DOCTOR" onPunch={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Go home' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Come to work' })).toBeEnabled()
})
```

- [ ] **Step 2: FAIL, implement bar from component spec, add StatusBadge keys:**

```ts
CLOCKED_IN: 'border-emerald-200 bg-emerald-100 text-emerald-700',
CLOCKED_OUT: 'border-slate-200 bg-slate-100 text-slate-700',
AT_DOCTOR: 'border-sky-200 bg-sky-100 text-sky-700',
BOOKED: 'border-emerald-200 bg-emerald-100 text-emerald-700',
```

`PAUSED` already exists.

- [ ] **Step 3:** On `MechanicQueuePage` header right `flex` (next to refresh), render compact `AttendancePunchBar` wired to `useHrMeClock` / `usePunchClock`. 403 → hide bar (no employee link).

- [ ] **Step 4: PASS. Commit.**

```
git commit -m "feat(hr): add punch bar and mechanic queue clock"
```

---

### Task 9: HR layout, employees, clock, leave UI

**Files:** pages under `src/pages/hr/`, Settings tab, sidebar, `App.tsx`

- [ ] **Step 1: Routes** in `App.tsx` inside the office shell (not mechanic):

```tsx
<Route path="hr" element={<HrLayout />}>
  <Route index element={<Navigate to="employees" replace />} />
  <Route path="employees" element={<HrEmployeesPage />} />
  <Route path="clock" element={<HrClockPage />} />
  <Route path="leave" element={<HrLeavePage />} />
</Route>
```

Sidebar after Workshop Board:

```ts
{
  id: 'hr',
  label: 'HR',
  to: '/hr/employees',
  icon: Users,
  isVisible: () => true,
  isActive: (pathname) => pathname.startsWith('/hr'),
},
```

TECH never sees this sidebar (`ShellRouter` already swaps the mechanic shell).

- [ ] **Step 2: `HrLayout`** — title HR, shadcn Tabs synced to the three paths, `Outlet`.

- [ ] **Step 3: Employees** — extract shared table from `EmployeeSettingsTab` into `apps/core-web/src/components/hr/EmployeeTable.tsx` (or keep the tab and import it from `HrEmployeesPage`). Add hire date, leave days, remaining columns (OWNER/ADMIN editable; SALES read-only). Employee sheet: carryover this year. `+ Employee` top-right.

- [ ] **Step 4: Clock page** — large `AttendancePunchBar`, today timeline from `todayEvents`. OWNER/ADMIN: employee select (self → `/me/clock`, other → `POST /api/hr/attendance` with no `occurredAt`), day picker + team `DataTable` from `useHrAttendance`.

- [ ] **Step 5: Leave page** — remaining chip, `+ Leave` opens `LeaveBookingSheet`, list with StatusBadge, Cancel. OWNER/ADMIN/SALES: `TeamLeaveMonthGrid` (CSS grid). No FullCalendar.

- [ ] **Step 6: Vitest** for layout tab hrefs and leave sheet submit calling `onSubmit({ startOn, endOn })`. Commit.

```
git commit -m "feat(hr): add HR employees, clock, and leave pages"
```

---

### Task 10: Planner `employeesAway` + realtime

**Files:** planner DTO/service, frontend planner warning, entity map

- [ ] **Step 1: Failing planner spec**

```ts
it('includes BOOKED leave overlapping the range as employeesAway', async () => {
  prisma.leaveRequest.findMany.mockResolvedValue([
    {
      id: 'l1',
      employee_id: 'e1',
      start_on: new Date('2026-08-24'),
      end_on: new Date('2026-08-26'),
      employee: { name: 'Ada' },
    },
  ]);
  const grid = await service.getGrid({ from: '2026-08-24', to: '2026-08-24' });
  expect(grid.employeesAway).toEqual([
    expect.objectContaining({ employeeId: 'e1', name: 'Ada', leaveId: 'l1' }),
  ]);
});
```

Do **not** return 409 from booking because someone is away.

- [ ] **Step 2:** Add `PlannerEmployeeAwayDto` to `PlannerGridResponseDto.employeesAway`. Query BOOKED leave overlapping planner `from`/`to`.

- [ ] **Step 3:** Planner UI: `Alert` when the assigned mechanic (or any mechanic on a booking) is in `employeesAway` — amber, submit still enabled (create sheet already has mechanic-overlap Alert).

- [ ] **Step 4:** `DashboardEntityType` + frontend map:

```ts
ATTENDANCE_EVENT: { dashboardSourceKeys: [], domainQueryKeys: [hrKeys.all] },
LEAVE_REQUEST: { dashboardSourceKeys: [], domainQueryKeys: [hrKeys.all, workshopKeys.all] },
```

- [ ] **Step 5: PASS. Commit.**

```
git commit -m "feat(hr): warn on planner when a mechanic is on leave"
```

---

### Task 11: Mintlify user guide

**Files:** `hr.mdx`, `docs.json`, `settings/employees.mdx`

Read `.agents/skills/mintlify-docs/SKILL.md`. Write for the person at the counter. No ADR numbers, no AUT keys, no Prisma.

- Opening: HR is where you add people, punch the clock, and book holidays. Shop holidays stay under Settings Hours.
- Steps: `+ Employee`, punch Come to work, `+ Leave`, remaining chip.
- Warning: Pause on the clock is not Pause on a job.
- Tip: Public holidays do not use up leave days.
- Accordion: no employee linked / cancel leave / mechanic tablet buttons.

Link from `settings/employees.mdx`. Add the page to `docs.json` Guides.

```
git commit -m "docs(hr): add HR time and leave user guide"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Employee hire + allowance | 2, 9 |
| AttendanceEvent + transitions + 409 | 4 |
| Manager list/correct | 5 |
| Nightly AUTO_SHIFT_CLOSE | 5 |
| Workdays skip closed shop days | 3, 6 |
| Leave book/cancel/remaining | 6, 9 |
| No year-spanning range | 6 |
| `/api/employees` kept | 2 |
| TECH `/me` only | 4, 6 e2e |
| Mechanic punch bar | 8 |
| Planner warning not 409 | 10 |
| Realtime | 10 |
| Mintlify | 11 |
| Deletion + SystemPrisma allowlist | 1 |
| Leave days column vs yearly balance | 2, 6, 9 |
| Carryover on employee sheet | 6, 9 |
| SALES cannot write HR fields | 2 e2e |
| Manager punch-for-other | 5, 9 |
| No LaborEntry / WorkshopHoliday reuse | all tasks |

## Type consistency

- Punch types: `CLOCK_IN` \| `PAUSE` \| `DOCTOR` \| `CLOCK_OUT`
- States: `CLOCKED_OUT` \| `CLOCKED_IN` \| `PAUSED` \| `AT_DOCTOR`
- Leave status: `BOOKED` \| `CANCELLED`
- Query factory: `hrKeys` only (do not invent `leaveKeys`)
- Date JSON: `hiredOn`, `startOn`, `endOn` as `YYYY-MM-DD`
- Remaining field: `remainingLeaveDays`
