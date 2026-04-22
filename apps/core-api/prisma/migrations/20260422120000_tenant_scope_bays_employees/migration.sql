-- AlterTable
ALTER TABLE "employees" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "bays" ADD COLUMN "tenant_id" TEXT;

DO $$
DECLARE
  default_tenant_id TEXT;
BEGIN
  SELECT id INTO default_tenant_id
  FROM "tenants"
  ORDER BY "created_at" ASC
  LIMIT 1;

  IF default_tenant_id IS NULL THEN
    default_tenant_id := '00000000-0000-0000-0000-000000000000';
    INSERT INTO "tenants" (
      "id",
      "name",
      "slug",
      "plan",
      "created_at",
      "updated_at",
      "is_active"
    ) VALUES (
      default_tenant_id,
      'Default Workshop',
      'default-workshop',
      'STANDARD',
      NOW(),
      NOW(),
      TRUE
    );
  END IF;

  UPDATE "employees"
  SET "tenant_id" = default_tenant_id
  WHERE "tenant_id" IS NULL;

  UPDATE "bays"
  SET "tenant_id" = default_tenant_id
  WHERE "tenant_id" IS NULL;
END $$;

ALTER TABLE "employees" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "bays" ALTER COLUMN "tenant_id" SET NOT NULL;

DROP INDEX IF EXISTS "bays_name_key";

-- CreateIndex
CREATE INDEX "employees_tenant_id_idx" ON "employees"("tenant_id");
CREATE UNIQUE INDEX "employees_tenant_id_id_key" ON "employees"("tenant_id", "id");
CREATE INDEX "bays_tenant_id_idx" ON "bays"("tenant_id");
CREATE UNIQUE INDEX "bays_tenant_id_id_key" ON "bays"("tenant_id", "id");
CREATE UNIQUE INDEX "bays_tenant_id_name_key" ON "bays"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bays" ADD CONSTRAINT "bays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
