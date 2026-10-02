-- CreateEnum
CREATE TYPE "LoanerVehicleStatus" AS ENUM ('AVAILABLE', 'ON_LOAN', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "LoanerBookingStatus" AS ENUM ('RESERVED', 'HANDED_OVER', 'RETURNED', 'CANCELLED', 'NO_SHOW');

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenant_id_id_key" ON "vehicles"("tenant_id", "id");

-- CreateTable
CREATE TABLE "loaner_vehicles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "LoanerVehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "daily_rate_cents" INTEGER,
    "insurance_note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loaner_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loaner_bookings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "loaner_vehicle_id" TEXT NOT NULL,
    "workshop_order_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "planned_from" TIMESTAMP(3) NOT NULL,
    "planned_to" TIMESTAMP(3) NOT NULL,
    "status" "LoanerBookingStatus" NOT NULL DEFAULT 'RESERVED',
    "handed_over_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "odometer_out" INTEGER,
    "odometer_in" INTEGER,
    "fuel_out" INTEGER,
    "fuel_in" INTEGER,
    "damage_notes_out" TEXT,
    "damage_notes_in" TEXT,
    "driver_licence_checked" BOOLEAN NOT NULL DEFAULT false,
    "licence_checked_by_id" TEXT,
    "notes" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loaner_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loaner_vehicles_tenant_id_idx" ON "loaner_vehicles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "loaner_vehicles_tenant_id_id_key" ON "loaner_vehicles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "loaner_vehicles_tenant_id_vehicle_id_key" ON "loaner_vehicles"("tenant_id", "vehicle_id");

-- CreateIndex
CREATE INDEX "loaner_vehicles_tenant_id_site_id_idx" ON "loaner_vehicles"("tenant_id", "site_id");

-- CreateIndex
CREATE INDEX "loaner_bookings_tenant_id_idx" ON "loaner_bookings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "loaner_bookings_tenant_id_id_key" ON "loaner_bookings"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "loaner_bookings_tenant_id_loaner_vehicle_id_idx" ON "loaner_bookings"("tenant_id", "loaner_vehicle_id");

-- CreateIndex
CREATE INDEX "loaner_bookings_tenant_id_workshop_order_id_idx" ON "loaner_bookings"("tenant_id", "workshop_order_id");

-- AddForeignKey
ALTER TABLE "loaner_vehicles" ADD CONSTRAINT "loaner_vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loaner_vehicles" ADD CONSTRAINT "loaner_vehicles_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loaner_vehicles" ADD CONSTRAINT "loaner_vehicles_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_tenant_id_loaner_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "loaner_vehicle_id") REFERENCES "loaner_vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_tenant_id_licence_checked_by_id_fkey" FOREIGN KEY ("tenant_id", "licence_checked_by_id") REFERENCES "employees"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Overlap prevention for active bookings on the same loaner vehicle
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "loaner_bookings"
ADD CONSTRAINT "loaner_bookings_no_active_overlap"
EXCLUDE USING gist (
    "tenant_id" WITH =,
    "loaner_vehicle_id" WITH =,
    tsrange("planned_from", "planned_to", '[)') WITH &&
)
WHERE ("status" IN ('RESERVED', 'HANDED_OVER'));
