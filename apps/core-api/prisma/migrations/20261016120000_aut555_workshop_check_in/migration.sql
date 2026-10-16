-- AUT-555: workshop vehicle check-in aggregate (1:1 per order) and media purpose scoping

CREATE TYPE "WorkshopCheckInStatus" AS ENUM ('DRAFT', 'COMPLETED');

CREATE TYPE "WorkshopMediaPurpose" AS ENUM ('GENERAL', 'CHECK_IN', 'CHECK_IN_SIGNATURE');

CREATE TABLE "workshop_check_ins" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workshop_order_id" TEXT NOT NULL,
    "status" "WorkshopCheckInStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "condition_json" JSONB NOT NULL DEFAULT '{}',
    "damage_markers_json" JSONB NOT NULL DEFAULT '[]',
    "items_left" TEXT NOT NULL DEFAULT '',
    "key_count" INTEGER NOT NULL DEFAULT 0,
    "warning_lights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "odometer" INTEGER NOT NULL,
    "fuel_level" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_check_ins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workshop_check_ins_tenant_id_id_key" ON "workshop_check_ins"("tenant_id", "id");

CREATE UNIQUE INDEX "workshop_check_ins_tenant_id_workshop_order_id_key" ON "workshop_check_ins"("tenant_id", "workshop_order_id");

CREATE INDEX "workshop_check_ins_tenant_id_idx" ON "workshop_check_ins"("tenant_id");

ALTER TABLE "workshop_check_ins" ADD CONSTRAINT "workshop_check_ins_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workshop_check_ins" ADD CONSTRAINT "workshop_check_ins_tenant_id_workshop_order_id_fkey"
FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workshop_media" ADD COLUMN "check_in_id" TEXT,
ADD COLUMN "purpose" "WorkshopMediaPurpose" NOT NULL DEFAULT 'GENERAL';

CREATE INDEX "idx_workshop_media_check_in" ON "workshop_media"("tenant_id", "check_in_id");

ALTER TABLE "workshop_media" ADD CONSTRAINT "workshop_media_tenant_id_check_in_id_fkey"
FOREIGN KEY ("tenant_id", "check_in_id") REFERENCES "workshop_check_ins"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
