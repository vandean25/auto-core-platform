# Workshop Planner Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Service Advisor calendar at `/workshop/planner`: tenant hours + holidays, bay occupancy, `SCHEDULED` bookings, and intake promote of the same `WO-` number.

**Architecture:** Occupancy is the `WorkshopOrder` itself (`scheduled_start_at` / `scheduled_end_at` + existing `bay_id`). Hours and holidays are a tenant singleton (`WorkshopSettings` + seven `WorkshopOpeningHour` rows + `WorkshopHoliday`). Public holidays are copied from OpenHolidays API into `WorkshopHoliday`; `GET /planner` never calls the vendor. New Nest services stay under 1500 lines; do not grow `workshop-intake.service.ts` with planner/settings/holiday code.

**Tech Stack:** Prisma 6 / PostgreSQL, NestJS, class-validator, Jest e2e, React 19, Vite, Vitest, TanStack Query, Tailwind v4, shadcn Sheet/Alert/Card, `@dnd-kit/core` (already on the board). No FullCalendar. No `HttpModule` today — OpenHolidays uses injectable `fetch` with a 3s timeout.

**Spec:** `docs/internal/02-Feature-Specs/Workshop/2026-08-21-workshop-planner-calendar.md`

**ADR:** `docs/internal/01-ADR/2026-08-21-workshop-planner-calendar.md`

**Component spec:** `docs/internal/03-Component-Specs/workshop/WorkshopPlannerPage.md`

**Linear:** [Workshop Planner Calendar](https://linear.app/auto-core-platform/project/workshop-planner-calendar-9da198210de2) — AUT-174 settings/holidays, AUT-175 planner API, AUT-176 promote, AUT-177 UI, AUT-178 Mintlify.

**Do not:** put a time axis on `/workshop/board`; seed a hardcoded AT/DE holiday table; live-query OpenHolidays from the planner GET or the browser; overwrite `MANUAL` holiday rows on import.

---

## File map

### Prisma / cleanup

- Modify: `apps/core-api/prisma/schema.prisma` — enum `WorkshopHolidaySource`; models `WorkshopSettings`, `WorkshopOpeningHour`, `WorkshopHoliday`; `WorkshopOrder.scheduled_start_at` / `scheduled_end_at`; `Tenant` relations
- Create: `apps/core-api/prisma/migrations/20260821120000_workshop_planner_calendar/migration.sql`
- Modify: `apps/core-api/test/tenant-test-utils.ts` — delete holidays, opening hours, settings **before** `tenant.deleteMany`
- Modify: `apps/core-api/src/prisma/prisma-audit.extension.ts` — add `WorkshopSettings`, `WorkshopOpeningHour`, `WorkshopHoliday` to `AUDITED_MODELS` (same class as `FinanceSettings`)
- Modify: `apps/core-api/src/prisma/prisma-audit.extension.spec.ts` — assert those three models
- Modify: `apps/core-api/src/prisma/system-prisma.service.spec.ts` — add `workshopSettings` to `TENANT_MODEL_DELEGATES` (must stay omitted from SystemPrisma)
- Modify: `docs/deletion-policy.md` — settings/hours/holiday/order rows from the spec

### New API files (keep intake under 1500 lines)

- Create: `apps/core-api/src/workshop/workshop-hours.defaults.ts` — weekday seed constants + HH:mm helpers
- Create: `apps/core-api/src/workshop/workshop-settings.service.ts`
- Create: `apps/core-api/src/workshop/workshop-settings.service.spec.ts`
- Create: `apps/core-api/src/workshop/workshop-holiday.service.ts`
- Create: `apps/core-api/src/workshop/workshop-holiday.service.spec.ts`
- Create: `apps/core-api/src/workshop/openholidays.client.ts` — `fetch` wrapper, 3s abort
- Create: `apps/core-api/src/workshop/openholidays.client.spec.ts`
- Create: `apps/core-api/src/workshop/workshop-planner.service.ts`
- Create: `apps/core-api/src/workshop/workshop-planner.service.spec.ts`
- Create: `apps/core-api/src/workshop/workshop-schedule.service.ts` — bay overlap + create/patch `SCHEDULED` + delete `SCHEDULED`
- Create: `apps/core-api/src/workshop/workshop-schedule.service.spec.ts`
- Create: `apps/core-api/src/workshop/dto/workshop-settings.dto.ts`
- Create: `apps/core-api/src/workshop/dto/workshop-holiday.dto.ts`
- Create: `apps/core-api/src/workshop/dto/workshop-planner.dto.ts`
- Modify: `apps/core-api/src/workshop/dto/create-workshop-order.dto.ts`
- Modify: `apps/core-api/src/workshop/dto/update-workshop-order.dto.ts`
- Modify: `apps/core-api/src/workshop/workshop.module.ts`
- Modify: `apps/core-api/src/workshop/workshop.controller.ts`
- Modify: `apps/core-api/src/workshop/workshop.controller.spec.ts`
- Modify: `apps/core-api/src/workshop/workshop-intake.service.ts` — promote on create; optional schedule fields delegated to schedule service
- Modify: `apps/core-api/src/workshop/workshop-intake.service.spec.ts`
- Modify: `apps/core-api/src/workshop/workshop.spec.support.ts` — mock new Prisma delegates
- Create: `apps/core-api/test/workshop-planner.e2e-spec.ts`
- Modify: `apps/core-api/src/workshop/workshop-service-size.spec.ts` — no change expected if new files stay small; run it

### Frontend

- Modify: `apps/core-web/src/api/workshop.ts` — keys + hooks
- Modify: `apps/core-web/src/App.tsx` — lazy route `/workshop/planner`
- Modify: `apps/core-web/src/components/navigation/AppSidebar.tsx` — Calendar item after Workshop Board
- Modify: `apps/core-web/src/pages/SettingsPage.tsx` — Hours tab
- Modify: `apps/core-web/src/pages/SettingsPage.test.tsx`
- Create: `apps/core-web/src/components/settings/WorkshopHoursSettingsTab.tsx`
- Create: `apps/core-web/src/components/settings/WorkshopHoursSettingsTab.test.tsx`
- Create: `apps/core-web/src/components/settings/WorkshopHolidayDialog.tsx`
- Create: `apps/core-web/src/pages/workshop/WorkshopPlannerPage.tsx`
- Create: `apps/core-web/src/pages/workshop/WorkshopPlannerPage.test.tsx`
- Create: `apps/core-web/src/components/workshop/planner/PlannerDayGrid.tsx`
- Create: `apps/core-web/src/components/workshop/planner/PlannerWeekGrid.tsx`
- Create: `apps/core-web/src/components/workshop/planner/PlannerBookingBlock.tsx`
- Create: `apps/core-web/src/components/workshop/planner/PlannerCreateSheet.tsx`
- Modify: `apps/core-web/src/features/realtime/dashboard-entity-map.ts` — `workshopKeys.all` already covers planner; add an explicit comment + test that `WORKSHOP_ORDER` invalidates keys starting with `workshop`
- Modify: `apps/core-web/src/features/realtime/dashboard-entity-map.test.ts` if a planner-key assertion is missing
- Regen: `apps/core-api/openapi/openapi.json` then `apps/core-web/src/api/generated/openapi.ts`

### Docs

- Modify: `docs/internal/02-Feature-Specs/Workshop/2026-08-21-workshop-planner-calendar.md` — point implementation sequence at this plan
- Create: `workflows/workshop-planner.mdx`
- Modify: `docs.json` — insert after `workflows/workshop-board`
- Create: `settings/workshop-hours.mdx`
- Modify: `settings.mdx` — Hours card
- Modify: `workflows/workshop-board.mdx` — one sentence: Board has no clock; bookings live on Workshop Planner
- Modify: `workflows/workshop-intake.mdx` — promote vs walk-in

---

### Task 1: Prisma schema + migration + tenant cleanup

**Files:** schema, migration, `tenant-test-utils.ts`, audit extension, system-prisma spec, `docs/deletion-policy.md`

- [ ] **Step 1: Write failing schema contract test** in `apps/core-api/src/prisma/workshop-planner-schema.spec.ts`

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workshop planner Prisma schema', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');

  it('defines WorkshopSettings singleton and holiday source enum', () => {
    expect(schema).toContain('enum WorkshopHolidaySource');
    expect(schema).toContain('model WorkshopSettings');
    expect(schema).toContain('model WorkshopOpeningHour');
    expect(schema).toContain('model WorkshopHoliday');
    expect(schema).toContain('scheduled_start_at');
    expect(schema).toContain('scheduled_end_at');
    expect(schema).toContain('idx_workshop_orders_bay_schedule');
    expect(schema).toContain('@@map("workshop_settings")');
    expect(schema).toContain('@@map("workshop_opening_hours")');
    expect(schema).toContain('@@map("workshop_holidays")');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (models missing)

```
npm --prefix apps/core-api test -- src/prisma/workshop-planner-schema.spec.ts
```

- [ ] **Step 3: Add models to `schema.prisma`**

On `Tenant`, add:

```prisma
workshopSettings     WorkshopSettings?
workshopOpeningHours WorkshopOpeningHour[]
workshopHolidays     WorkshopHoliday[]
```

After `Bay`, insert enum + three models exactly as in the feature spec (composite `@@unique([tenant_id, id])` on settings/hours/holiday; hours `@@unique([tenant_id, weekday])`; holiday `@@unique([tenant_id, observed_on])`; tenant-safe FK `fields: [tenant_id, workshop_settings_id], references: [tenant_id, id]`).

On `WorkshopOrder` add:

```prisma
scheduled_start_at DateTime?
scheduled_end_at   DateTime?

@@index([tenant_id, bay_id, scheduled_start_at], map: "idx_workshop_orders_bay_schedule")
```

Do **not** put hours on `FinanceSettings`.

- [ ] **Step 4: Create migration** `apps/core-api/prisma/migrations/20260821120000_workshop_planner_calendar/migration.sql`

Use `npx prisma migrate diff` from the API package, or write SQL that:

1. Creates enum `"WorkshopHolidaySource"` (`MANUAL`, `IMPORTED`)
2. Creates the three tables with FKs to `tenants(id)` and composite FK to settings
3. Adds nullable timestamptz columns + index on `workshop_orders`

- [ ] **Step 5: Apply locally**

```
npm --prefix apps/core-api exec prisma migrate deploy
```

Expected: migration applied.

- [ ] **Step 6: Cleanup + audit + SystemPrisma**

In `cleanupTestTenantGraph`, **before** `workshopOrder.deleteMany` is fine for holidays (no FK from orders). Delete in this order so settings cascade is not required if you delete children first:

```ts
await tenantPrisma.workshopHoliday.deleteMany({});
await tenantPrisma.workshopOpeningHour.deleteMany({});
await tenantPrisma.workshopSettings.deleteMany({});
```

Place these **before** `prisma.tenant.deleteMany`. If they run after `workshopOrder.deleteMany` that is also fine.

Add `WorkshopSettings`, `WorkshopOpeningHour`, `WorkshopHoliday` to `AUDITED_MODELS` and the audit spec.

Add `'workshopSettings'` to `TENANT_MODEL_DELEGATES` in `system-prisma.service.spec.ts`.

Update `docs/deletion-policy.md` WorkshopOrder row and add:

| Entity | Delete Allowed | Rule |
|---|---|---|
| WorkshopSettings | No | Singleton; update in place only. |
| WorkshopOpeningHour | No | Seven weekday rows; replace via PUT, never delete independently. |
| WorkshopHoliday | Yes | Hard delete. Not referenced by orders. |
| WorkshopOrder | Conditional | Hard delete allowed only while `SCHEDULED` (planner no-show). Blocked from `INTAKE` onward. |

- [ ] **Step 7: Re-run schema test + audit spec — expect PASS. Commit.**

```
git commit -m "feat(workshop): add planner settings, holidays, and schedule columns"
```

---

### Task 2: Settings GET/PUT (seed seven weekdays)

**Files:** `workshop-hours.defaults.ts`, `dto/workshop-settings.dto.ts`, `workshop-settings.service.ts` + spec, controller, module

RBAC: copy `TenantMemberService.assertTenantAdminAccess` into the settings/holiday **write** methods (`user.role` is `OWNER` or `ADMIN`). Reads allowed for any tenant member (SALES included). TECH never hits this UI.

- [ ] **Step 1: Failing unit tests** in `workshop-settings.service.spec.ts`

Use `workshop.spec.support` mocks. Extend `mockPrisma` with:

```ts
workshopSettings: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
workshopOpeningHour: { findMany: jest.fn(), createMany: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
```

Also add `getAuthenticatedUser` on `mockTenantContext` returning `{ role: 'ADMIN', tenantId: '...', userId: 'u', email: 'a@b.c' }`.

Cases:

1. `getSettings` when no row exists creates settings + 7 opening hours (Mon–Fri 07:30–17:00, Sat 08:00–12:00, Sun closed) and returns `openingHours.length === 7`.
2. `updateSettings` with 6 weekdays throws `BadRequestException`.
3. `updateSettings` with `slotMinutes: 20` throws `BadRequestException`.
4. `updateSettings` with `closeTime <= openTime` on an open day throws `BadRequestException`.
5. `updateSettings` with invalid IANA timezone throws `BadRequestException`.
6. `updateSettings` as SALES (`role: 'SALES'`) throws `ForbiddenException`.

Timezone check:

```ts
function isValidIanaTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
```

Allowed `slotMinutes`: `15 | 30 | 60` via `@IsIn([15, 30, 60])`.

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './workshop-settings.service'`)

```
npm --prefix apps/core-api test -- src/workshop/workshop-settings.service.spec.ts
```

- [ ] **Step 3: Implement**

`DEFAULT_OPENING_HOURS` in `workshop-hours.defaults.ts`:

```ts
export const DEFAULT_OPENING_HOURS = [
  { weekday: 1, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 2, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 3, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 4, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 6, isClosed: false, openTime: '08:00', closeTime: '12:00' },
  { weekday: 7, isClosed: true, openTime: '07:30', closeTime: '17:00' },
] as const;

export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
```

`getOrCreateSettings(tenantId)` upserts the singleton and, if opening hours count !== 7, `createMany` the defaults. `PUT` replaces all seven in one `$transaction` (update each weekday by `tenant_id + weekday`). Response DTO camelCase as spec: `timezone`, `slotMinutes`, `holidayCountryIso`, `holidaySubdivisionCode`, `openingHours`.

Controller (register **before** `orders/:id` is irrelevant; these are sibling paths):

```
GET  /workshop/settings
PUT  /workshop/settings
```

Wire providers in `workshop.module.ts`. Update `workshop.controller.spec.ts` constructor mocks for the new services.

- [ ] **Step 4: Re-run unit tests — PASS. Commit.**

```
git commit -m "feat(workshop): add hours settings GET/PUT with weekday seed"
```

---

### Task 3: Holiday CRUD + annual collision

**Files:** holiday DTOs, `workshop-holiday.service.ts` + spec, controller routes

- [ ] **Step 1: Failing tests** in `workshop-holiday.service.spec.ts`

1. Create closed holiday `{ name: 'Betriebsurlaub', observedOn: '2026-12-24', isClosed: true }` → returns `source: 'MANUAL'`, `repeatsAnnually: false`.
2. Create short day without `openTime`/`closeTime` when `isClosed: false` → `BadRequestException`.
3. Create when a one-off already exists on that date → `ConflictException`.
4. Create annual `12-25` when a one-off `2026-12-25` exists → `ConflictException`.
5. Create annual `12-25` when another annual `2020-12-25` exists → `ConflictException`.
6. Delete returns void / service does `deleteMany` with id+tenant.
7. List without range uses current tenant year through next year (mock timezone `Europe/Vienna`).
8. SALES create → `ForbiddenException`.

Collision helper (shared with import):

```ts
export function holidayCollides(
  existing: { observed_on: Date; repeats_annually: boolean }[],
  candidate: { observedOn: Date; repeatsAnnually: boolean },
  excludeId?: string,
): boolean
```

Month-day compare with UTC date parts of `@db.Date` values. 29 Feb annual rows are stored; expansion skips non-leap years (planner task).

- [ ] **Step 2: Run — FAIL. Implement. Routes:**

Register **`POST holidays/import` before `PATCH/DELETE holidays/:id`**.

```
GET    /workshop/holidays
POST   /workshop/holidays
POST   /workshop/holidays/import
PATCH  /workshop/holidays/:id
DELETE /workshop/holidays/:id   → 204
```

`GET` optional `from`/`to` as `YYYY-MM-DD`. Default: 1 Jan of current year in settings timezone through 31 Dec of next year.

- [ ] **Step 3: PASS. Commit.**

```
git commit -m "feat(workshop): add holiday CRUD with annual collision checks"
```

---

### Task 4: OpenHolidays import

**Files:** `openholidays.client.ts` + spec, holiday service `importPublicHolidays`

Vendor:

```
GET https://openholidaysapi.org/PublicHolidays
  ?countryIsoCode={iso}
  &languageIsoCode=DE
  &validFrom={year}-01-01
  &validTo={year+1}-12-31
  [&subdivisionCode=...]
```

- [ ] **Step 1: Client unit tests** with `global.fetch` mocked

1. Maps `type === 'Public'` + (`nationwide === true` OR subdivision matches) + `startDate === endDate`.
2. Skips `type: 'School'` and multi-day ranges.
3. German name: `name.find(n => n.language === 'DE')?.text`.
4. Abort after 3s → throw a typed `OpenHolidaysTimeoutError`.
5. Non-2xx → throw `OpenHolidaysUnavailableError`.

Inject via token:

```ts
export const OPENHOLIDAYS_FETCH = 'OPENHOLIDAYS_FETCH';
export type OpenHolidaysFetch = typeof fetch;
```

Default provider: `fetch`. Tests bind a mock.

- [ ] **Step 2: Import service tests**

1. Upserts kept rows as `source=IMPORTED`, `repeats_annually=false`, `is_closed=true`, `external_id=id`.
2. Existing `IMPORTED` same `observed_on`: refresh `name`, count as skipped or imported=0 on second call (spec: idempotent; use `skipped++` when row exists).
3. Existing `MANUAL` same date: **do not overwrite**, `skipped++`.
4. Client timeout → service throws `BadGatewayException`; no writes (transaction after fetch, or fetch first then transaction).
5. Uses `holiday_country_iso` from settings when DTO omits country.

Keep filter in one function `selectPublicHolidayDays(payload, subdivisionCode)`.

- [ ] **Step 3: Implement. Timeout:**

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 3000);
```

- [ ] **Step 4: PASS. Commit.**

```
git commit -m "feat(workshop): import public holidays from OpenHolidays API"
```

---

### Task 5: Planner occupancy GET

**Files:** `workshop-planner.service.ts` + spec, planner DTOs, `GET /workshop/planner`

Effective hours for local date `D`:

1. One-off holiday `observed_on = D` wins.
2. Else annual holiday whose month+day equals `D` (skip 29 Feb in non-leap years).
3. Else weekday opening.

- [ ] **Step 1: Failing tests**

Range: parse `from`/`to` as ISO instants. If missing or `to - from > 8 days` → `BadRequestException`.

Cases:

1. Range 9 days → 400.
2. Returns active bays ordered by `sort_order` then `name` (same as board resources).
3. Closed holiday in range appears in `holidays` with `isClosed: true` and `date` as `YYYY-MM-DD` in tenant tz.
4. 29 Feb annual omitted when the range is 2025 (non-leap).
5. Timed `SCHEDULED` overlapping window is a `BOOKING`.
6. `COMPLETED` / `INVOICED` excluded.
7. Null timestamps on `INTAKE` with a bay: if query range intersects **today** in tenant tz, emit `UNSCHEDULED_ON_FLOOR` with synthetic start/end = today's effective open→close; if today fully closed, local midnight→next midnight.
8. Promise.all: assert the service does not await bays then settings sequentially in a loop (no N+1). Spy `findMany` call count for orders === 1.

Order query (one `findMany`):

```ts
status: { in: ['SCHEDULED', 'INTAKE', 'IN_PROGRESS'] },
bay_id: { not: null },
OR: [
  { scheduled_start_at: { lt: to }, scheduled_end_at: { gt: from } },
  {
    scheduled_start_at: null,
    scheduled_end_at: null,
    status: { in: ['INTAKE', 'IN_PROGRESS'] },
  },
],
```

Then filter unscheduled rows in memory: keep only if `[from, to)` intersects today (tenant tz). Optional `bayId` adds `bay_id: bayId`.

Include customer, vehicle, mechanic. Zero per-row awaits.

- [ ] **Step 2: FAIL then implement. Convert wall-clock `HH:mm` + date + IANA tz to UTC with a small helper** (no extra date lib if `Temporal` is unavailable — use `Intl` or existing `date-fns-tz` only if already a dependency; otherwise compute via:

```ts
function zonedWallClockToUtc(timeZone: string, y: number, m: number, d: number, hh: number, mm: number): Date
```

Implement with offset probe: format a UTC guess in the zone and adjust. Cover DST in a unit test: `Europe/Vienna` 2026-03-29 02:30 should not throw; 2026-03-29 01:30 and 03:30 are valid.

- [ ] **Step 3: PASS. Commit.**

```
git commit -m "feat(workshop): add planner occupancy GET"
```

---

### Task 6: Create/patch `SCHEDULED` + bay overlap 409

**Files:** create/update DTOs, `workshop-schedule.service.ts`, intake `create` delegates schedule create, `DELETE /workshop/orders/:id`

Overlap: half-open `[start, end)`. Occupying orders = timed bookings overlapping **or** unscheduled on-floor whose synthetic window overlaps. Same `id` excluded on patch. Different bays allowed. Mechanic double-book allowed.

- [ ] **Step 1: Failing tests** in `workshop-schedule.service.spec.ts` + intake spec

Create DTO: `status?`, `bayId?`, `mechanicId?`, `scheduledStartAt?`, `scheduledEndAt?`. `odometer`/`fuelLevel` `@IsOptional()` + `@ValidateIf` required when `status !== SCHEDULED` (default INTAKE).

```ts
@ValidateIf((dto: CreateWorkshopOrderDto) => dto.status !== WorkshopOrderStatus.SCHEDULED)
@IsInt()
@Min(0)
odometer?: number;
```

Service rules:

- `SCHEDULED` requires `bayId` + both timestamps, `end > start`, active bay, optional mechanic must be active `role = MECHANIC`.
- Omitted odometer/fuel on `SCHEDULED` persist `0`.
- Walk-in (no status / INTAKE, no timestamps) still requires odometer/fuel and writes `INTAKE` as today.
- Overlap → `ConflictException` whose message includes the colliding `order_number`.
- After-hours / Sunday / holiday → **200**, no 422.
- `PATCH` schedule/bay only while `SCHEDULED` or `INTAKE`.
- `DELETE` while `SCHEDULED` → delete; `INTAKE` → `BadRequestException`.

- [ ] **Step 2: Implement overlap inside `$transaction`** using `findMany` of occupying rows for that bay, then in-memory interval test including synthetic today window (reuse planner helper `effectiveWindowForLocalDate`).

Do **not** put this logic in `workshop-intake.service.ts` beyond: `if (dto.status === SCHEDULED) return this.scheduleService.createScheduled(dto)` and patch schedule fields delegated similarly.

- [ ] **Step 3: Controller `DELETE orders/:id`** returning 204. Register carefully so it does not swallow `orders/:id/tasks`.

- [ ] **Step 4: PASS. Commit.**

```
git commit -m "feat(workshop): create and reschedule booked orders with bay overlap 409"
```

---

### Task 7: Intake promote `SCHEDULED → INTAKE`

**Files:** `workshop-intake.service.ts` + spec

On **every** `create()` for a vehicle (walk-in Start Service included):

1. `findMany` `SCHEDULED` for `vehicle_id` + tenant.
2. If any: pick `min(|scheduled_start_at - now|)` (null start last). `updateMany({ where: { id, status: SCHEDULED }, data: { status: INTAKE, odometer, fuel_level, reported_issue } })`.
3. If `count === 0`: another request won. If any remaining `SCHEDULED|INTAKE|IN_PROGRESS` for that vehicle → `409` with that order id. Else fall through to insert.
4. If none scheduled: if any active `INTAKE|IN_PROGRESS` (and remaining `SCHEDULED`) for that vehicle → `409`. Else insert `INTAKE` as today.

Do not increment the `WO-` sequence on promote.

- [ ] **Step 1: Failing tests**

1. Existing `SCHEDULED` + create INTAKE for same vehicle → `updateMany` called, `financeSettings.update` **not** called, same `order_number` returned.
2. Two actives: create while `INTAKE` already exists → `ConflictException`.
3. `updateMany` count 0 and live INTAKE exists → `ConflictException`, no second insert.
4. Different vehicle walk-in still inserts.

- [ ] **Step 2: Implement with ADR-0011 `updateMany` guard. PASS. Commit.**

```
git commit -m "feat(workshop): promote scheduled orders to intake instead of duplicating"
```

---

### Task 8: OpenAPI + web types + query keys

- [ ] **Step 1:** `npm --prefix apps/core-api run openapi:generate`
- [ ] **Step 2:** `npm --prefix apps/core-web run api:types:generate`
- [ ] **Step 3:** Extend `workshopKeys` in `apps/core-web/src/api/workshop.ts`:

```ts
planner: (from: string, to: string, bayId?: string) =>
  [...workshopKeys.all, 'planner', from, to, bayId ?? 'all'] as const,
settings: () => [...workshopKeys.all, 'settings'] as const,
holidays: (from?: string, to?: string) =>
  [...workshopKeys.all, 'holidays', from ?? 'year', to ?? 'year'] as const,
```

Add `useWorkshopSettings`, `useUpdateWorkshopSettings`, `useWorkshopHolidays`, `useCreateWorkshopHoliday`, `useImportWorkshopHolidays`, `useDeleteWorkshopHoliday`, `useWorkshopPlanner`, `useCreateWorkshopOrder` (if missing), `useRescheduleWorkshopOrder`, `useDeleteScheduledWorkshopOrder`.

`WORKSHOP_ORDER` already invalidates `workshopKeys.all` in `dashboard-entity-map.ts`. Add a test in `dashboard-entity-map.test.ts`:

```ts
expect(getQueryKeysToInvalidateForEntityType('WORKSHOP_ORDER')).toEqual(
  expect.arrayContaining([workshopKeys.all]),
)
```

Do not add settings/holiday to websocket map (spec: refetch on return from Settings).

- [ ] **Step 4: Commit.**

```
git commit -m "feat(workshop): regenerate OpenAPI types and planner query keys"
```

---

### Task 9: Settings Hours tab

**Files:** `WorkshopHoursSettingsTab.tsx` + test, `WorkshopHolidayDialog.tsx`, `SettingsPage.tsx` + test

- [ ] **Step 1: Failing SettingsPage test** — OWNER/ADMIN sees tab **Hours**; SALES sees Hours (read-only). Add `'hours'` to `VALID_TABS`. Grid cols: 11 when `canManageTeam`, 10 otherwise (Hours is visible to SALES). `canManageHours = canManageTeam`. Link target `?tab=hours`.

Place the trigger **after Bays** (workshop resources sit together).

- [ ] **Step 2: Hours tab tests**

1. Renders seven weekday rows and a Save button (not autosave).
2. Holidays table has `+ Holiday` and **Import public holidays**.
3. Import button calls `POST /api/workshop/holidays/import`.
4. Copy includes `Public holidays from OpenHolidays API.`
5. SALES: Save / + Holiday / Import disabled.

Dialog fields: name, date, annual toggle, closed vs short hours (`openTime`/`closeTime` required when not closed).

- [ ] **Step 3: Implement. PASS. Commit.**

```
git commit -m "feat(workshop): add Settings Hours tab with holiday import"
```

---

### Task 10: Planner page (day, week, create, drag)

**Files:** page + planner components + App route + sidebar

- [ ] **Step 1: Failing `WorkshopPlannerPage.test.tsx`** (mirror `WorkshopBoard.test.tsx` QueryClient + mocked `workshop` API)

1. Title `Workshop Planner`; Day/Week toggle; `+ Workshop Order`.
2. No bays → card "No bays configured" + link to `/settings?tab=bays`.
3. Closed weekday → "Workshop closed" + link `/settings?tab=hours`.
4. Closed holiday → `Closed — Nationalfeiertag` + hours link.
5. Click empty cell opens sheet with bay + start; end = start + 60 minutes.
6. Occupied `SCHEDULED` click navigates to `/workshop/orders/:id`.
7. Toggle persists `localStorage` key `workshop-planner-view`.
8. Drag `SCHEDULED` calls PATCH; `INTAKE` is not draggable.

Reuse board dnd mocks. Empty cell click: `data-testid="planner-slot-{bayId}-{isoStart}"`.

Sidebar: import `Calendar` from lucide-react, item **after** `workshop-board`:

```ts
{
  id: 'workshop-planner',
  label: 'Workshop Planner',
  to: '/workshop/planner',
  icon: Calendar,
  isVisible: () => true,
  isActive: (pathname) => pathname.startsWith('/workshop/planner'),
}
```

Keep **Workshop Board** label unchanged.

Route in `App.tsx` next to board:

```ts
const WorkshopPlannerPage = React.lazy(() => import('./pages/workshop/WorkshopPlannerPage'))
// ...
<Route path="/workshop/planner" element={<WorkshopPlannerPage />} />
```

Create sheet: reuse intake search (`useWorkshopSearch` if it exists; otherwise the same `GET /api/workshop/search` helper). Outside-hours and mechanic-overlap: non-blocking `Alert`. Client-side bay collision disables submit; server 409 still toasts.

Week grid: columns = days in `[from, to)`; click empty region opens sheet with that day + bay, start = effective open.

- [ ] **Step 2: Implement CSS grids** (not FullCalendar). Day: rows = bays, columns = slots from effective open→close in `slotMinutes`. Overlay bookings by `gridColumn` span.

- [ ] **Step 3: PASS. Commit.**

```
git commit -m "feat(workshop): add planner calendar page with day and week grids"
```

---

### Task 11: E2E + Mintlify

**Files:** `apps/core-api/test/workshop-planner.e2e-spec.ts`, Mintlify pages, `docs.json`

Follow `workshop-intake.e2e-spec.ts`: `createTestTenant`, `createTestAuthToken`, `cleanupTestTenantGraph`.

Must-cover HTTP cases (from spec testing plan):

- Settings seed + PUT validation (missing weekday, bad slot, close <= open)
- Holiday CRUD, annual expansion on GET planner, 29 Feb skip, collision 409
- Import AT: mock fetch in e2e **or** record a fixture JSON of 13 nationwide 2026 days; do not flake on live OpenHolidays. Inject `OPENHOLIDAYS_FETCH` in the testing module if the app module allows override; otherwise unit-test import thoroughly and e2e-test MANUAL holidays only. Prefer fixture: put `apps/core-api/test/fixtures/openholidays-at-2026.json` and bind fetch in e2e `beforeAll` via a test-only provider **if** AppModule exports it. If AppModule cannot override easily, skip live import e2e and keep client+service unit tests as the import contract.
- Planner range > 8 days → 400
- Create SCHEDULED; walk-in still INTAKE
- Same bay overlap 409; different bays 200; mechanic overlap 200; after-hours 200
- Unscheduled INTAKE blocks same-day timed booking; next local day allowed
- PATCH into taken slot 409
- Promote keeps `order_number`; sequence not incremented
- DELETE SCHEDULED 204; DELETE INTAKE 400

Mintlify (read `.agents/skills/mintlify-docs/SKILL.md` before writing MDX):

- `workflows/workshop-planner.mdx` — advisor books a bay; Board vs Planner one-liner
- `settings/workshop-hours.mdx` — weekdays, holidays, Import public holidays, OpenHolidays attribution
- `docs.json` Workshop group: insert `workflows/workshop-planner` after board; Settings group add `settings/workshop-hours`
- Intake + board pages: promote and “no clock on the kanban”

- [ ] **Step 1: Write e2e, run**

```
npm --prefix apps/core-api test -- test/workshop-planner.e2e-spec.ts
```

- [ ] **Step 2: Mintlify pages. Commit.**

```
git commit -m "test(workshop): planner e2e and user guide for hours and calendar"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| WorkshopSettings / OpeningHour / Holiday schema, composite uniques | 1 |
| scheduled_start_at/end_at + bay index | 1 |
| Deletion policy | 1 |
| GET/PUT settings, 7-day seed, slot 15/30/60, IANA tz, not on FinanceSettings | 2 |
| OWNER/ADMIN write, SALES read | 2, 3, 9 |
| Holiday CRUD, annual collision, 29 Feb | 3, 5 |
| OpenHolidays import, copy-not-live-query, skip MANUAL, 3s → 502, type=Public | 4 |
| GET /planner max 8 days, Promise.all, BOOKING vs UNSCHEDULED_ON_FLOOR | 5 |
| Holiday overlay + closed/short effective hours | 5, 10 |
| POST SCHEDULED + optional odometer 0, bay 409, mechanic warning only, after-hours 200 | 6 |
| PATCH schedule while SCHEDULED/INTAKE | 6 |
| DELETE SCHEDULED only | 6 |
| Promote same WO-, block second active job | 7 |
| OpenAPI regen | 8 |
| workshopKeys.planner/settings/holidays; WORKSHOP_ORDER invalidates all | 8 |
| Hours tab + import UI | 9 |
| /workshop/planner, sidebar after board, day/week, Sheet, dnd SCHEDULED only | 10 |
| Empty states no bays / closed weekday / Closed — {name} | 10 |
| E2E list in spec | 11 |
| Mintlify workshop-planner + Hours | 11 |
| No time axis on kanban | 10 (do not edit board canvas) |

**Placeholder scan:** no TBD / “implement later” / “similar to Task N” without code.

**Type consistency:** DTO names match spec (`slotMinutes`, `holidayCountryIso`, `occupancyKind`, `BOOKING` \| `UNSCHEDULED_ON_FLOOR`). Prisma columns stay snake_case.

---

## Execution notes

- Run `workshop-service-size.spec.ts` after each new `*.service.ts`.
- `cleanupTestTenantGraph` must delete the new tables or tenant teardown fails every suite.
- Production egress must allow `openholidaysapi.org` (document in Hours MDX + settings copy only; do not change Cloud Run YAML unless a file already lists egress domains).
- Keep `/workshop/board` labeled **Workshop Board**.
