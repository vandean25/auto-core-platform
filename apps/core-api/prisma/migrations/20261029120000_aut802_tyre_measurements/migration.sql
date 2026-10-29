-- CreateEnum
CREATE TYPE "TyreWheelPosition" AS ENUM ('FL', 'FR', 'RL', 'RR', 'SPARE');

-- CreateEnum
CREATE TYPE "TyreConstruction" AS ENUM ('RADIAL', 'DIAGONAL');

-- CreateEnum
CREATE TYPE "TyreWinterMarking" AS ENUM ('NONE', 'M_S', 'ALPINE');

-- CreateEnum
CREATE TYPE "TyreVehicleWeightClass" AS ENUM ('UP_TO_3500_KG', 'OVER_3500_KG');

-- CreateEnum
CREATE TYPE "TyreWeightClassSource" AS ENUM ('DEFAULT', 'CAPTURE');

-- AlterTable
ALTER TABLE "tyre_storage_settings" ADD COLUMN     "recommendation_overrides" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "tyre_measurements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "workshop_order_id" TEXT,
    "check_in_id" TEXT,
    "tyre_set_id" TEXT,
    "tyre_set_event_id" TEXT,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "measured_by" TEXT,
    "measured_by_name" TEXT NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "weight_class" "TyreVehicleWeightClass" NOT NULL DEFAULT 'UP_TO_3500_KG',
    "weight_class_source" "TyreWeightClassSource" NOT NULL DEFAULT 'DEFAULT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tyre_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tyre_wheel_readings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "measurement_id" TEXT NOT NULL,
    "position" "TyreWheelPosition" NOT NULL,
    "tread_inner_mm" DECIMAL(5,2) NOT NULL,
    "tread_middle_mm" DECIMAL(5,2) NOT NULL,
    "tread_outer_mm" DECIMAL(5,2) NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "size" TEXT,
    "dot" TEXT,
    "season" "TyreSeason" NOT NULL,
    "construction" "TyreConstruction" NOT NULL DEFAULT 'RADIAL',
    "winter_marking" "TyreWinterMarking" NOT NULL DEFAULT 'NONE',
    "media_id" TEXT,
    "evaluation" JSONB NOT NULL,

    CONSTRAINT "tyre_wheel_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tyre_measurements_tenant_id_site_id_measured_at_idx" ON "tyre_measurements"("tenant_id", "site_id", "measured_at");

-- CreateIndex
CREATE INDEX "tyre_measurements_tenant_id_vehicle_id_measured_at_idx" ON "tyre_measurements"("tenant_id", "vehicle_id", "measured_at");

-- CreateIndex
CREATE INDEX "tyre_measurements_tenant_id_workshop_order_id_measured_at_idx" ON "tyre_measurements"("tenant_id", "workshop_order_id", "measured_at");

-- CreateIndex
CREATE INDEX "tyre_measurements_tenant_id_check_in_id_measured_at_idx" ON "tyre_measurements"("tenant_id", "check_in_id", "measured_at");

-- CreateIndex
CREATE INDEX "tyre_measurements_tenant_id_tyre_set_event_id_measured_at_idx" ON "tyre_measurements"("tenant_id", "tyre_set_event_id", "measured_at");

-- CreateIndex
CREATE INDEX "tyre_measurements_tenant_id_tyre_set_id_idx" ON "tyre_measurements"("tenant_id", "tyre_set_id");

-- CreateIndex
CREATE INDEX "tyre_measurements_measured_by_idx" ON "tyre_measurements"("measured_by");

-- CreateIndex
CREATE UNIQUE INDEX "tyre_measurements_tenant_id_id_key" ON "tyre_measurements"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "tyre_wheel_readings_tenant_id_media_id_idx" ON "tyre_wheel_readings"("tenant_id", "media_id");

-- CreateIndex
CREATE UNIQUE INDEX "tyre_wheel_readings_tenant_id_id_key" ON "tyre_wheel_readings"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tyre_wheel_readings_tenant_id_measurement_id_position_key" ON "tyre_wheel_readings"("tenant_id", "measurement_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_orders_tyre_context_key" ON "workshop_orders"("tenant_id", "site_id", "vehicle_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tyre_sets_tenant_id_site_id_vehicle_id_id_key" ON "tyre_sets"("tenant_id", "site_id", "vehicle_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tyre_set_events_tenant_id_tyre_set_id_id_key" ON "tyre_set_events"("tenant_id", "tyre_set_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_check_ins_tenant_id_workshop_order_id_id_key" ON "workshop_check_ins"("tenant_id", "workshop_order_id", "id");

-- AddForeignKey
ALTER TABLE "tyre_measurements" ADD CONSTRAINT "tyre_measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_measurements" ADD CONSTRAINT "tyre_measurements_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tyre_measurements" ADD CONSTRAINT "tyre_measurements_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tyre_measurements" ADD CONSTRAINT "tyre_measurements_tenant_id_site_id_vehicle_id_workshop_or_fkey" FOREIGN KEY ("tenant_id", "site_id", "vehicle_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "site_id", "vehicle_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tyre_measurements" ADD CONSTRAINT "tyre_measurements_tenant_id_workshop_order_id_check_in_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id", "check_in_id") REFERENCES "workshop_check_ins"("tenant_id", "workshop_order_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tyre_measurements" ADD CONSTRAINT "tyre_measurements_tenant_id_site_id_vehicle_id_tyre_set_id_fkey" FOREIGN KEY ("tenant_id", "site_id", "vehicle_id", "tyre_set_id") REFERENCES "tyre_sets"("tenant_id", "site_id", "vehicle_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tyre_measurements" ADD CONSTRAINT "tyre_measurements_tenant_id_tyre_set_id_tyre_set_event_id_fkey" FOREIGN KEY ("tenant_id", "tyre_set_id", "tyre_set_event_id") REFERENCES "tyre_set_events"("tenant_id", "tyre_set_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tyre_measurements" ADD CONSTRAINT "tyre_measurements_measured_by_fkey" FOREIGN KEY ("measured_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tyre_wheel_readings" ADD CONSTRAINT "tyre_wheel_readings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_wheel_readings" ADD CONSTRAINT "tyre_wheel_readings_tenant_id_measurement_id_fkey" FOREIGN KEY ("tenant_id", "measurement_id") REFERENCES "tyre_measurements"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tyre_wheel_readings" ADD CONSTRAINT "tyre_wheel_readings_tenant_id_media_id_fkey" FOREIGN KEY ("tenant_id", "media_id") REFERENCES "workshop_media"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Nullable composite foreign keys must not bypass parent consistency.
ALTER TABLE "tyre_measurements"
  ADD CONSTRAINT "tyre_measurements_check_in_requires_order" CHECK ("check_in_id" IS NULL OR "workshop_order_id" IS NOT NULL),
  ADD CONSTRAINT "tyre_measurements_event_requires_set" CHECK ("tyre_set_event_id" IS NULL OR "tyre_set_id" IS NOT NULL);

ALTER TABLE "tyre_wheel_readings"
  ADD CONSTRAINT "tyre_wheel_readings_tread_range" CHECK (
    "tread_inner_mm" BETWEEN 0 AND 20 AND
    "tread_middle_mm" BETWEEN 0 AND 20 AND
    "tread_outer_mm" BETWEEN 0 AND 20
  );
