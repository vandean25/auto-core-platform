-- CreateEnum
CREATE TYPE "TyreSeason" AS ENUM ('SUMMER', 'WINTER', 'ALL_SEASON');

-- CreateEnum
CREATE TYPE "TyreRimType" AS ENUM ('NONE', 'STEEL', 'ALLOY');

-- CreateEnum
CREATE TYPE "TyreSetStatus" AS ENUM ('IN_STORAGE', 'ON_VEHICLE', 'RETURNED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "TyreSetEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'MOVED', 'INSPECTED', 'DISPOSED');

-- CreateTable
CREATE TABLE "tyre_storage_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "summer_swap_month" INTEGER NOT NULL DEFAULT 3,
    "summer_swap_day" INTEGER NOT NULL DEFAULT 1,
    "winter_swap_month" INTEGER NOT NULL DEFAULT 10,
    "winter_swap_day" INTEGER NOT NULL DEFAULT 1,
    "due_for_swap_days" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tyre_storage_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tyre_sets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "site_id" TEXT NOT NULL,
    "location_id" TEXT,
    "label" TEXT NOT NULL,
    "season" "TyreSeason" NOT NULL,
    "tyre_count" INTEGER NOT NULL DEFAULT 4,
    "rim_type" "TyreRimType" NOT NULL DEFAULT 'NONE',
    "brand" TEXT,
    "model" TEXT,
    "dimension" TEXT,
    "dot_codes" TEXT[],
    "tread_depth_mm_json" JSONB,
    "condition_notes" TEXT,
    "status" "TyreSetStatus" NOT NULL DEFAULT 'IN_STORAGE',
    "stored_since" DATE,
    "planned_swap_on" DATE,
    "bin_label" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tyre_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tyre_set_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tyre_set_id" TEXT NOT NULL,
    "event_type" "TyreSetEventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "workshop_order_id" TEXT,
    "from_location_id" TEXT,
    "to_location_id" TEXT,
    "odometer" INTEGER,
    "tread_depth_mm_json" JSONB,
    "note" TEXT,
    "employee_id" TEXT,
    "created_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tyre_set_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tyre_storage_settings_tenant_id_key" ON "tyre_storage_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "tyre_storage_settings_tenant_id_idx" ON "tyre_storage_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tyre_sets_tenant_id_id_key" ON "tyre_sets"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "tyre_sets_tenant_id_status_idx" ON "tyre_sets"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tyre_sets_tenant_id_customer_id_idx" ON "tyre_sets"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "tyre_sets_tenant_id_site_id_status_idx" ON "tyre_sets"("tenant_id", "site_id", "status");

-- CreateIndex
CREATE INDEX "tyre_sets_tenant_id_planned_swap_on_idx" ON "tyre_sets"("tenant_id", "planned_swap_on");

-- CreateIndex
CREATE INDEX "tyre_set_events_tenant_id_idx" ON "tyre_set_events"("tenant_id");

-- CreateIndex
CREATE INDEX "tyre_set_events_tenant_id_tyre_set_id_idx" ON "tyre_set_events"("tenant_id", "tyre_set_id");

-- CreateIndex
CREATE INDEX "tyre_set_events_tenant_id_occurred_at_idx" ON "tyre_set_events"("tenant_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "tyre_storage_settings" ADD CONSTRAINT "tyre_storage_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_sets" ADD CONSTRAINT "tyre_sets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_sets" ADD CONSTRAINT "tyre_sets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_sets" ADD CONSTRAINT "tyre_sets_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_sets" ADD CONSTRAINT "tyre_sets_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_sets" ADD CONSTRAINT "tyre_sets_tenant_id_site_id_location_id_fkey" FOREIGN KEY ("tenant_id", "site_id", "location_id") REFERENCES "storage_locations"("tenant_id", "site_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_set_events" ADD CONSTRAINT "tyre_set_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_set_events" ADD CONSTRAINT "tyre_set_events_tenant_id_tyre_set_id_fkey" FOREIGN KEY ("tenant_id", "tyre_set_id") REFERENCES "tyre_sets"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_set_events" ADD CONSTRAINT "tyre_set_events_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_set_events" ADD CONSTRAINT "tyre_set_events_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_set_events" ADD CONSTRAINT "tyre_set_events_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_set_events" ADD CONSTRAINT "tyre_set_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
