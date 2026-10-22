-- Expand-only schema M3 for legacy DMS migration vehicle parties and notices (AUT-641)

CREATE TYPE "VehiclePartyRole" AS ENUM ('OWNER', 'DRIVER', 'USER', 'BILL_TO', 'LEASING', 'INSURANCE', 'WARRANTY_PROVIDER', 'SERVICE_CONTRACT', 'PREVIOUS_OWNER');

CREATE TYPE "VehicleNoticeType" AS ENUM ('CAMPAIGN', 'RECALL', 'REMARK', 'WARNING', 'SERVICE_DUE');

CREATE TYPE "VehicleNoticeStatus" AS ENUM ('OPEN', 'DONE', 'DISMISSED');

CREATE TYPE "VehicleRecordSource" AS ENUM ('MANUAL', 'LEGACY_IMPORT');

-- The new value is not used in a default or CHECK in this migration.
ALTER TYPE "VehicleInspectionRecordSource" ADD VALUE IF NOT EXISTS 'LEGACY_IMPORT';

CREATE TABLE "vehicle_parties" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "role" "VehiclePartyRole" NOT NULL,
    "valid_from" DATE,
    "valid_to" DATE,
    "source" "VehicleRecordSource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_parties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vehicle_notices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "type" "VehicleNoticeType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "status" "VehicleNoticeStatus" NOT NULL DEFAULT 'OPEN',
    "due_date" DATE,
    "due_mileage" INTEGER,
    "external_ref" TEXT,
    "source" "VehicleRecordSource" NOT NULL DEFAULT 'MANUAL',
    "created_by_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,
    "resolved_workshop_order_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_notices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vehicle_parties_tenant_id_vehicle_id_idx" ON "vehicle_parties"("tenant_id", "vehicle_id");
CREATE INDEX "vehicle_parties_tenant_id_customer_id_idx" ON "vehicle_parties"("tenant_id", "customer_id");
CREATE UNIQUE INDEX "vehicle_parties_tenant_id_id_key" ON "vehicle_parties"("tenant_id", "id");

CREATE INDEX "vehicle_notices_tenant_id_vehicle_id_status_idx" ON "vehicle_notices"("tenant_id", "vehicle_id", "status");
CREATE UNIQUE INDEX "vehicle_notices_tenant_id_id_key" ON "vehicle_notices"("tenant_id", "id");

ALTER TABLE "vehicle_parties" ADD CONSTRAINT "vehicle_parties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_parties" ADD CONSTRAINT "vehicle_parties_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_parties" ADD CONSTRAINT "vehicle_parties_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_notices" ADD CONSTRAINT "vehicle_notices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_notices" ADD CONSTRAINT "vehicle_notices_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Postgres 15 column-list ON DELETE SET NULL (Prisma onDelete: SetNull cannot emit the column list; SQL is authoritative)
ALTER TABLE "vehicle_notices" ADD CONSTRAINT "vehicle_notices_tenant_id_resolved_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "resolved_workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE SET NULL ("resolved_workshop_order_id") ON UPDATE CASCADE;

-- SQL-only: interval sanity. Half-open [valid_from, valid_to) needs valid_from < valid_to when both are set.
ALTER TABLE "vehicle_parties" ADD CONSTRAINT "vehicle_parties_valid_interval_check"
  CHECK ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_from" < "valid_to");

-- SQL-only: backstop for the party service. At most one open-ended OWNER, BILL_TO and LEASING per vehicle.
-- Historical and future range overlaps stay a service check under the vehicle row lock.
CREATE UNIQUE INDEX "vehicle_parties_one_active_singleton_role_key"
  ON "vehicle_parties"("tenant_id", "vehicle_id", "role")
  WHERE "valid_to" IS NULL AND "role" IN ('OWNER', 'BILL_TO', 'LEASING');

-- SQL-only: a campaign, recall or service schedule reference is unique per vehicle and type.
CREATE UNIQUE INDEX "vehicle_notices_external_ref_key"
  ON "vehicle_notices"("tenant_id", "vehicle_id", "type", "external_ref")
  WHERE "external_ref" IS NOT NULL;
