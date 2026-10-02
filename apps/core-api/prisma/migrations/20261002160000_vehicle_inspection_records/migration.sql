-- Expand-only: §57a Pickerl inspection records (AUT-377)
CREATE TYPE "VehicleInspectionType" AS ENUM ('PICKERL_57A');

CREATE TYPE "VehicleInspectionRecordSource" AS ENUM ('MANUAL');

CREATE TABLE "vehicle_inspection_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "inspection_type" "VehicleInspectionType" NOT NULL,
    "inspected_on" DATE NOT NULL,
    "plaketten_valid_until_year" INTEGER NOT NULL,
    "plaketten_valid_until_month" INTEGER NOT NULL,
    "station_name" TEXT,
    "source" "VehicleInspectionRecordSource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_inspection_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_inspection_records_tenant_id_id_key" ON "vehicle_inspection_records"("tenant_id", "id");

CREATE INDEX "idx_vehicle_inspection_records_vehicle_inspected" ON "vehicle_inspection_records"("tenant_id", "vehicle_id", "inspected_on");

ALTER TABLE "vehicle_inspection_records" ADD CONSTRAINT "vehicle_inspection_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_inspection_records" ADD CONSTRAINT "vehicle_inspection_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
