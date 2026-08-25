-- Correct the AUT-193 backfill without rewriting its already-applied migration.

-- Employees without a hired_on date need the tenant-local date as the initial
-- schedule effective date.
UPDATE "employee_work_schedules" s
SET "effective_from" = (
    CURRENT_TIMESTAMP AT TIME ZONE COALESCE(ws."timezone", 'Europe/Vienna')
)::date
FROM "employees" e
LEFT JOIN "workshop_settings" ws ON ws."tenant_id" = e."tenant_id"
WHERE s."tenant_id" = e."tenant_id"
  AND s."employee_id" = e."id"
  AND e."hired_on" IS NULL;

-- The original migration's fallback pattern averaged 515 minutes. When a
-- tenant has no opening-hour rows, the ADR-0020 fallback is 480 minutes and
-- no working weekday pattern is available to charge.
CREATE TEMP TABLE "_hr_no_opening_schedule" AS
SELECT s."tenant_id", s."employee_id", s."id" AS schedule_id
FROM "employee_work_schedules" s
WHERE NOT EXISTS (
    SELECT 1
    FROM "workshop_opening_hours" woh
    WHERE woh."tenant_id" = s."tenant_id"
);

UPDATE "employee_work_schedule_days" sd
SET
    "is_working" = false,
    "start_time" = NULL,
    "end_time" = NULL,
    "break_minutes" = 0
FROM "_hr_no_opening_schedule" s
WHERE sd."tenant_id" = s."tenant_id"
  AND sd."schedule_id" = s.schedule_id;

UPDATE "employees" e
SET "annual_leave_minutes" = ROUND(e."annual_leave_minutes" * 480.0 / 515.0)::integer
FROM "_hr_no_opening_schedule" s
WHERE e."tenant_id" = s."tenant_id"
  AND e."id" = s."employee_id";

UPDATE "employee_leave_balances" b
SET
    "allowance_minutes" = ROUND(b."allowance_minutes" * 480.0 / 515.0)::integer,
    "carryover_minutes" = ROUND(b."carryover_minutes" * 480.0 / 515.0)::integer
FROM "_hr_no_opening_schedule" s
WHERE b."tenant_id" = s."tenant_id"
  AND b."employee_id" = s."employee_id";

UPDATE "leave_requests" lr
SET "minutes_charged" = ROUND(lr."minutes_charged" * 480.0 / 515.0)::integer
FROM "_hr_no_opening_schedule" s
WHERE lr."tenant_id" = s."tenant_id"
  AND lr."employee_id" = s."employee_id";

DROP TABLE "_hr_no_opening_schedule";
