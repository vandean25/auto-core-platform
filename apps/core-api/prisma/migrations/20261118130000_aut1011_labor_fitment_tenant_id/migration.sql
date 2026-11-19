-- AUT-1011: Scope LaborFitment by tenant_id with composite FK to LaborOperation.
-- Note: LocalInventory is removed from schema.prisma, but dropping "local_inventories"
-- is intentionally deferred to a separate contract step.

-- 1. Expand-only column
ALTER TABLE "labor_fitments" ADD COLUMN "tenant_id" TEXT;

-- 2. Backfill from parent labor_operations
UPDATE "labor_fitments" AS lf
SET "tenant_id" = lo."tenant_id"
FROM "labor_operations" AS lo
WHERE lf."labor_operation_id" = lo."id"
  AND lf."tenant_id" IS NULL;

-- 3. Enforce NOT NULL
ALTER TABLE "labor_fitments" ALTER COLUMN "tenant_id" SET NOT NULL;

-- 4. Parent composite unique key and child tenant_id index
CREATE UNIQUE INDEX "labor_operations_tenant_id_id_key" ON "labor_operations"("tenant_id", "id");
CREATE INDEX "labor_fitments_tenant_id_idx" ON "labor_fitments"("tenant_id");

-- 5. Replace single-column FK with tenant FK and composite (tenant_id, labor_operation_id) FK
ALTER TABLE "labor_fitments" DROP CONSTRAINT "labor_fitments_labor_operation_id_fkey";
ALTER TABLE "labor_fitments" ADD CONSTRAINT "labor_fitments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "labor_fitments" ADD CONSTRAINT "labor_fitments_tenant_id_labor_operation_id_fkey" FOREIGN KEY ("tenant_id", "labor_operation_id") REFERENCES "labor_operations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
