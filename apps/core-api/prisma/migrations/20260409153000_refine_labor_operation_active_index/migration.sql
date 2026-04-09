-- DropIndex
DROP INDEX "labor_operations_is_active_idx";

-- CreateIndex
CREATE INDEX "labor_operations_is_active_description_idx" ON "labor_operations"("is_active", "description");
