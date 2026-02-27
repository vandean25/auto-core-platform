-- CreateEnum
CREATE TYPE "WorkshopTaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'WAITING_PARTS', 'DONE');

-- CreateEnum
CREATE TYPE "WorkshopLineItemType" AS ENUM ('LABOR', 'PART');

-- AlterTable
ALTER TABLE "workshop_orders" ADD COLUMN "reported_issue" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "workshop_order_id" TEXT;

-- CreateTable
CREATE TABLE "workshop_tasks" (
    "id" TEXT NOT NULL,
    "workshop_order_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "WorkshopTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "mechanic_notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_task_line_items" (
    "id" TEXT NOT NULL,
    "workshop_task_id" TEXT NOT NULL,
    "type" "WorkshopLineItemType" NOT NULL,
    "item_no" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_task_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_workshop_order_id_key" ON "invoices"("workshop_order_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workshop_order_id_fkey" FOREIGN KEY ("workshop_order_id") REFERENCES "workshop_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_tasks" ADD CONSTRAINT "workshop_tasks_workshop_order_id_fkey" FOREIGN KEY ("workshop_order_id") REFERENCES "workshop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_task_line_items" ADD CONSTRAINT "workshop_task_line_items_workshop_task_id_fkey" FOREIGN KEY ("workshop_task_id") REFERENCES "workshop_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
