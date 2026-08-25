-- Phase 2 (AUT-193): employee work schedules + leave units in minutes

-- CreateTable
CREATE TABLE "employee_work_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_work_schedule_days" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "is_working" BOOLEAN NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "employee_work_schedule_days_pkey" PRIMARY KEY ("id")
);

-- Add minute columns alongside day columns for backfill
ALTER TABLE "employees" ADD COLUMN "annual_leave_minutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "employee_leave_balances" ADD COLUMN "allowance_minutes" INTEGER;
ALTER TABLE "employee_leave_balances" ADD COLUMN "carryover_minutes" INTEGER;
ALTER TABLE "leave_requests" ADD COLUMN "minutes_charged" INTEGER;

-- Seed one work schedule per employee from shop opening hours (or defaults)
INSERT INTO "employee_work_schedules" ("id", "tenant_id", "employee_id", "effective_from", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    e."tenant_id",
    e."id",
    COALESCE(e."hired_on", CURRENT_DATE),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "employees" e;

-- Schedule days from workshop_opening_hours when present
INSERT INTO "employee_work_schedule_days" (
    "id", "tenant_id", "schedule_id", "weekday", "is_working", "start_time", "end_time", "break_minutes"
)
SELECT
    gen_random_uuid()::text,
    e."tenant_id",
    s."id",
    woh."weekday",
    NOT woh."is_closed",
    CASE WHEN NOT woh."is_closed" THEN woh."open_time" ELSE NULL END,
    CASE WHEN NOT woh."is_closed" THEN woh."close_time" ELSE NULL END,
    0
FROM "employees" e
INNER JOIN "employee_work_schedules" s
    ON s."tenant_id" = e."tenant_id" AND s."employee_id" = e."id"
INNER JOIN "workshop_settings" ws ON ws."tenant_id" = e."tenant_id"
INNER JOIN "workshop_opening_hours" woh
    ON woh."tenant_id" = e."tenant_id" AND woh."workshop_settings_id" = ws."id";

-- Pad missing ISO weekdays 1-7 per schedule (same defaults as HrWorkScheduleService)
INSERT INTO "employee_work_schedule_days" (
    "id", "tenant_id", "schedule_id", "weekday", "is_working", "start_time", "end_time", "break_minutes"
)
SELECT
    gen_random_uuid()::text,
    s."tenant_id",
    s."id",
    d.weekday,
    d.is_working,
    d.start_time,
    d.end_time,
    0
FROM "employee_work_schedules" s
CROSS JOIN (
    VALUES
        (1, true, '07:30', '17:00'),
        (2, true, '07:30', '17:00'),
        (3, true, '07:30', '17:00'),
        (4, true, '07:30', '17:00'),
        (5, true, '07:30', '17:00'),
        (6, true, '08:00', '12:00'),
        (7, false, NULL::text, NULL::text)
) AS d(weekday, is_working, start_time, end_time)
WHERE NOT EXISTS (
    SELECT 1 FROM "employee_work_schedule_days" sd
    WHERE sd."schedule_id" = s."id"
      AND sd."tenant_id" = s."tenant_id"
      AND sd."weekday" = d.weekday
);

-- Per-employee average minutes per working day (fallback 480)
CREATE TEMP TABLE "_hr_schedule_avg" AS
SELECT
    s."tenant_id",
    s."employee_id",
    s."id" AS schedule_id,
    COALESCE(
        NULLIF(
            ROUND(AVG(
                EXTRACT(EPOCH FROM (sd."end_time"::time - sd."start_time"::time)) / 60.0
                - sd."break_minutes"
            ))::integer,
            0
        ),
        480
    ) AS avg_minutes
FROM "employee_work_schedules" s
LEFT JOIN "employee_work_schedule_days" sd
    ON sd."schedule_id" = s."id"
    AND sd."tenant_id" = s."tenant_id"
    AND sd."is_working" = true
    AND sd."start_time" IS NOT NULL
    AND sd."end_time" IS NOT NULL
GROUP BY s."tenant_id", s."employee_id", s."id";

UPDATE "employees" e
SET "annual_leave_minutes" = ROUND(e."annual_leave_days" * a.avg_minutes)::integer
FROM "_hr_schedule_avg" a
WHERE a."employee_id" = e."id" AND a."tenant_id" = e."tenant_id";

UPDATE "employee_leave_balances" b
SET
    "allowance_minutes" = ROUND(b."allowance_days" * a.avg_minutes)::integer,
    "carryover_minutes" = ROUND(b."carryover_days" * a.avg_minutes)::integer
FROM "_hr_schedule_avg" a
WHERE a."employee_id" = b."employee_id" AND a."tenant_id" = b."tenant_id";

UPDATE "leave_requests" lr
SET "minutes_charged" = ROUND(lr."days_charged" * a.avg_minutes)::integer
FROM "_hr_schedule_avg" a
WHERE a."employee_id" = lr."employee_id" AND a."tenant_id" = lr."tenant_id";

-- Drop day columns
ALTER TABLE "employees" DROP COLUMN "annual_leave_days";
ALTER TABLE "employee_leave_balances" DROP COLUMN "allowance_days";
ALTER TABLE "employee_leave_balances" DROP COLUMN "carryover_days";
ALTER TABLE "leave_requests" DROP COLUMN "days_charged";

ALTER TABLE "employee_leave_balances" ALTER COLUMN "allowance_minutes" SET NOT NULL;
ALTER TABLE "employee_leave_balances" ALTER COLUMN "carryover_minutes" SET NOT NULL;
ALTER TABLE "employee_leave_balances" ALTER COLUMN "carryover_minutes" SET DEFAULT 0;
ALTER TABLE "leave_requests" ALTER COLUMN "minutes_charged" SET NOT NULL;

DROP TABLE "_hr_schedule_avg";

-- Indexes
CREATE INDEX "employee_work_schedules_tenant_id_idx" ON "employee_work_schedules"("tenant_id");
CREATE UNIQUE INDEX "employee_work_schedules_tenant_id_id_key" ON "employee_work_schedules"("tenant_id", "id");
CREATE UNIQUE INDEX "employee_work_schedules_tenant_id_employee_id_effective_from_key"
    ON "employee_work_schedules"("tenant_id", "employee_id", "effective_from");

CREATE INDEX "employee_work_schedule_days_tenant_id_idx" ON "employee_work_schedule_days"("tenant_id");
CREATE UNIQUE INDEX "employee_work_schedule_days_tenant_id_id_key" ON "employee_work_schedule_days"("tenant_id", "id");
CREATE UNIQUE INDEX "employee_work_schedule_days_tenant_id_schedule_id_weekday_key"
    ON "employee_work_schedule_days"("tenant_id", "schedule_id", "weekday");

-- Foreign keys
ALTER TABLE "employee_work_schedules"
ADD CONSTRAINT "employee_work_schedules_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_work_schedules"
ADD CONSTRAINT "employee_work_schedules_tenant_id_employee_id_fkey"
FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_work_schedule_days"
ADD CONSTRAINT "employee_work_schedule_days_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_work_schedule_days"
ADD CONSTRAINT "employee_work_schedule_days_tenant_id_schedule_id_fkey"
FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "employee_work_schedules"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
