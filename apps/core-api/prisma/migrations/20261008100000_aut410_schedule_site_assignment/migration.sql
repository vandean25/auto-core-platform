ALTER TABLE "employee_work_schedules"
ADD COLUMN "site_id" TEXT;

ALTER TABLE "employee_work_schedules"
ADD CONSTRAINT "employee_work_schedules_tenant_site_fkey"
FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
