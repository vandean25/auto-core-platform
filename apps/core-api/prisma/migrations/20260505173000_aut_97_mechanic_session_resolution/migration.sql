-- AlterTable: Add user_id to employees, enabling server-side mechanic session resolution.
-- This nullable FK links an Employee record to a User (auth account), allowing the backend
-- to resolve the active mechanic from the authenticated session without requiring the client
-- to supply a mechanicId (ADR-0014 §1 target-state migration).
ALTER TABLE "employees" ADD COLUMN "user_id" TEXT;

-- Foreign key constraint: if the User row is deleted, set employee.user_id to NULL.
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for fast session-based employee lookup.
CREATE INDEX "employees_user_id_idx" ON "employees"("user_id");

-- Unique constraint: one employee profile per user per tenant.
-- Partial unique index to explicitly enforce uniqueness only when user_id is populated.
-- (NULL values are excluded, allowing multiple employees without a linked user account.)
CREATE UNIQUE INDEX "employees_tenant_id_user_id_key" ON "employees"("tenant_id", "user_id")
  WHERE "user_id" IS NOT NULL;
