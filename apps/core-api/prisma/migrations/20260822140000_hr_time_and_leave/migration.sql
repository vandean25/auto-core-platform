-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('BOOKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceEventType" AS ENUM ('CLOCK_IN', 'PAUSE', 'DOCTOR', 'CLOCK_OUT');

-- CreateEnum
CREATE TYPE "AttendanceEventSource" AS ENUM ('SELF', 'MANAGER', 'AUTO_SHIFT_CLOSE');

-- AlterTable
ALTER TABLE "employees"
ADD COLUMN "annual_leave_days" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN "hired_on" DATE;

-- CreateTable
CREATE TABLE "employee_leave_balances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "allowance_days" INTEGER NOT NULL,
    "carryover_days" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "start_on" DATE NOT NULL,
    "end_on" DATE NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'BOOKED',
    "days_charged" INTEGER NOT NULL,
    "note" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "AttendanceEventType" NOT NULL,
    "source" "AttendanceEventSource" NOT NULL DEFAULT 'SELF',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_leave_balances_tenant_id_idx"
ON "employee_leave_balances"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_leave_balances_tenant_id_id_key"
ON "employee_leave_balances"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_leave_balances_tenant_id_employee_id_year_key"
ON "employee_leave_balances"("tenant_id", "employee_id", "year");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_idx"
ON "leave_requests"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_requests_tenant_id_id_key"
ON "leave_requests"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_employee_id_start_on_idx"
ON "leave_requests"("tenant_id", "employee_id", "start_on");

-- CreateIndex
CREATE INDEX "attendance_events_tenant_id_idx"
ON "attendance_events"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_events_tenant_id_id_key"
ON "attendance_events"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "attendance_events_tenant_id_employee_id_occurred_at_idx"
ON "attendance_events"("tenant_id", "employee_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "employee_leave_balances"
ADD CONSTRAINT "employee_leave_balances_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_leave_balances"
ADD CONSTRAINT "employee_leave_balances_tenant_id_employee_id_fkey"
FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests"
ADD CONSTRAINT "leave_requests_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests"
ADD CONSTRAINT "leave_requests_tenant_id_employee_id_fkey"
FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events"
ADD CONSTRAINT "attendance_events_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events"
ADD CONSTRAINT "attendance_events_tenant_id_employee_id_fkey"
FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
