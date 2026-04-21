-- CreateEnum
CREATE TYPE "EmployeeRole" AS ENUM ('MECHANIC', 'SERVICE_ADVISOR', 'PARTS_CLERK');

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "EmployeeRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bays" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bays_name_key" ON "bays"("name");

-- AlterTable
ALTER TABLE "workshop_orders"
ADD COLUMN "mechanic_id" TEXT,
ADD COLUMN "bay_id" TEXT;

-- CreateIndex
CREATE INDEX "idx_workshop_orders_mechanic_id" ON "workshop_orders"("mechanic_id");

-- CreateIndex
CREATE INDEX "idx_workshop_orders_bay_id" ON "workshop_orders"("bay_id");

-- AddForeignKey
ALTER TABLE "workshop_orders" ADD CONSTRAINT "workshop_orders_mechanic_id_fkey"
FOREIGN KEY ("mechanic_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_orders" ADD CONSTRAINT "workshop_orders_bay_id_fkey"
FOREIGN KEY ("bay_id") REFERENCES "bays"("id") ON DELETE SET NULL ON UPDATE CASCADE;
