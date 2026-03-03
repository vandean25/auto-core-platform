-- CreateEnum
CREATE TYPE "WorkshopOrderStatus" AS ENUM ('SCHEDULED', 'INTAKE', 'IN_PROGRESS', 'COMPLETED', 'INVOICED');

-- CreateTable
CREATE TABLE "workshop_orders" (
    "id" TEXT NOT NULL,
    "status" "WorkshopOrderStatus" NOT NULL DEFAULT 'INTAKE',
    "customer_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "odometer" INTEGER NOT NULL,
    "fuel_level" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workshop_orders_odometer_check" CHECK ("odometer" >= 0),
    CONSTRAINT "workshop_orders_fuel_level_check" CHECK ("fuel_level" >= 0 AND "fuel_level" <= 100),

    CONSTRAINT "workshop_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_workshop_orders_customer_id" ON "workshop_orders"("customer_id");

-- CreateIndex
CREATE INDEX "idx_workshop_orders_vehicle_id" ON "workshop_orders"("vehicle_id");

-- AddForeignKey
ALTER TABLE "workshop_orders" ADD CONSTRAINT "workshop_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_orders" ADD CONSTRAINT "workshop_orders_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
