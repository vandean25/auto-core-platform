-- AlterEnum: Add WAITING_CUSTOMER and PAUSED to WorkshopTaskStatus
ALTER TYPE "WorkshopTaskStatus" ADD VALUE 'WAITING_CUSTOMER';
ALTER TYPE "WorkshopTaskStatus" ADD VALUE 'PAUSED';

-- CreateEnum: LaborPauseReason
CREATE TYPE "LaborPauseReason" AS ENUM (
  'WAITING_PARTS',
  'WAITING_CUSTOMER',
  'AUTO_SHIFT_CLOSE',
  'SWITCHED_TO_HIGHER_PRIORITY',
  'OTHER'
);

-- AlterTable: Add task-level assignment and queue ordering fields to workshop_tasks
ALTER TABLE "workshop_tasks"
  ADD COLUMN "mechanic_id" TEXT,
  ADD COLUMN "bay_id" TEXT,
  ADD COLUMN "scheduled_date" DATE,
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex: workshop_tasks assignment and scheduling
CREATE INDEX "idx_workshop_tasks_tenant_id_mechanic_id" ON "workshop_tasks"("tenant_id", "mechanic_id");
CREATE INDEX "idx_workshop_tasks_tenant_id_bay_id" ON "workshop_tasks"("tenant_id", "bay_id");
CREATE INDEX "idx_workshop_tasks_scheduled_date" ON "workshop_tasks"("scheduled_date");

-- AddForeignKey: workshop_tasks.(tenant_id, mechanic_id) -> employees.(tenant_id, id)
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_tenant_id_mechanic_id_fkey"
  FOREIGN KEY ("tenant_id", "mechanic_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: workshop_tasks.(tenant_id, bay_id) -> bays.(tenant_id, id)
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_tenant_id_bay_id_fkey"
  FOREIGN KEY ("tenant_id", "bay_id") REFERENCES "bays"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: labor_entries
CREATE TABLE "labor_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workshop_task_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "pause_reason" "LaborPauseReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: labor_entries
CREATE INDEX "labor_entries_tenant_id_idx" ON "labor_entries"("tenant_id");
CREATE UNIQUE INDEX "labor_entries_tenant_id_id_key" ON "labor_entries"("tenant_id", "id");
CREATE INDEX "labor_entries_workshop_task_id_idx" ON "labor_entries"("workshop_task_id");
CREATE INDEX "labor_entries_employee_id_idx" ON "labor_entries"("employee_id");
CREATE INDEX "labor_entries_ended_at_idx" ON "labor_entries"("ended_at");

-- AddForeignKey: labor_entries.tenant_id -> tenants.id
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: labor_entries.(tenant_id, workshop_task_id) -> workshop_tasks.(tenant_id, id)
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_tenant_id_workshop_task_id_fkey"
  FOREIGN KEY ("tenant_id", "workshop_task_id") REFERENCES "workshop_tasks"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: labor_entries.(tenant_id, employee_id) -> employees.(tenant_id, id)
ALTER TABLE "labor_entries" ADD CONSTRAINT "labor_entries_tenant_id_employee_id_fkey"
  FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employees"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
