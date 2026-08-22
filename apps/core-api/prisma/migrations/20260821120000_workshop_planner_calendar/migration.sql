-- CreateEnum
CREATE TYPE "WorkshopHolidaySource" AS ENUM ('MANUAL', 'IMPORTED');

-- AlterTable
ALTER TABLE "workshop_orders"
ADD COLUMN "scheduled_start_at" TIMESTAMP(3),
ADD COLUMN "scheduled_end_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "idx_workshop_orders_bay_schedule" ON "workshop_orders"("tenant_id", "bay_id", "scheduled_start_at");

-- CreateTable
CREATE TABLE "workshop_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Vienna',
    "slot_minutes" INTEGER NOT NULL DEFAULT 30,
    "holiday_country_iso" TEXT NOT NULL DEFAULT 'AT',
    "holiday_subdivision_code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_opening_hours" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workshop_settings_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "open_time" TEXT NOT NULL DEFAULT '07:30',
    "close_time" TEXT NOT NULL DEFAULT '17:00',

    CONSTRAINT "workshop_opening_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_holidays" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workshop_settings_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "observed_on" DATE NOT NULL,
    "repeats_annually" BOOLEAN NOT NULL DEFAULT false,
    "is_closed" BOOLEAN NOT NULL DEFAULT true,
    "open_time" TEXT,
    "close_time" TEXT,
    "source" "WorkshopHolidaySource" NOT NULL DEFAULT 'MANUAL',
    "external_id" TEXT,

    CONSTRAINT "workshop_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workshop_settings_tenant_id_key" ON "workshop_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_settings_tenant_id_id_key" ON "workshop_settings"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "workshop_settings_tenant_id_idx" ON "workshop_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_opening_hours_tenant_id_id_key" ON "workshop_opening_hours"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_opening_hours_tenant_id_weekday_key" ON "workshop_opening_hours"("tenant_id", "weekday");

-- CreateIndex
CREATE INDEX "workshop_opening_hours_tenant_id_idx" ON "workshop_opening_hours"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_holidays_tenant_id_id_key" ON "workshop_holidays"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_holidays_tenant_id_observed_on_key" ON "workshop_holidays"("tenant_id", "observed_on");

-- CreateIndex
CREATE INDEX "workshop_holidays_tenant_id_idx" ON "workshop_holidays"("tenant_id");

-- AddForeignKey
ALTER TABLE "workshop_settings" ADD CONSTRAINT "workshop_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_opening_hours" ADD CONSTRAINT "workshop_opening_hours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_opening_hours" ADD CONSTRAINT "workshop_opening_hours_tenant_id_workshop_settings_id_fkey" FOREIGN KEY ("tenant_id", "workshop_settings_id") REFERENCES "workshop_settings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_holidays" ADD CONSTRAINT "workshop_holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_holidays" ADD CONSTRAINT "workshop_holidays_tenant_id_workshop_settings_id_fkey" FOREIGN KEY ("tenant_id", "workshop_settings_id") REFERENCES "workshop_settings"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
