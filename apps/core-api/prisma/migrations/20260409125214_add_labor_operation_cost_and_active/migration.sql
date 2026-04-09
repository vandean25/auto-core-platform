-- AlterTable
ALTER TABLE "labor_operations" ADD COLUMN "internal_cost" DECIMAL(10,2),
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "labor_operations_is_active_idx" ON "labor_operations"("is_active");
