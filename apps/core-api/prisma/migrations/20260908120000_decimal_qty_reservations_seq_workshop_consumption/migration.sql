-- M3 Decimal Quantity, Reservations, Sequence, and Workshop Consumption Schema (AUT-242 / DB-3)

-- TransactionType: add WORKSHOP_CONSUMPTION
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'WORKSHOP_CONSUMPTION';

-- New enums for parts reservations and requisitions
CREATE TYPE "PartsReservationKind" AS ENUM ('ON_HAND', 'REQUISITION');
CREATE TYPE "PartsReservationStatus" AS ENUM ('OPEN', 'ORDERED', 'STAGED', 'FULFILLED', 'CANCELLED');
CREATE TYPE "PartsRequisitionStatus" AS ENUM ('DRAFT', 'ORDERED', 'COMPLETED', 'CANCELLED');

-- InventoryStock: widen quantity precision to DECIMAL(10,3)
ALTER TABLE "inventory_stocks"
  ALTER COLUMN "quantity_on_hand" TYPE DECIMAL(10, 3) USING "quantity_on_hand"::DECIMAL(10, 3),
  ALTER COLUMN "quantity_reserved" TYPE DECIMAL(10, 3) USING "quantity_reserved"::DECIMAL(10, 3);

-- PurchaseOrderItem: widen quantity precision to DECIMAL(10,3)
ALTER TABLE "purchase_order_items"
  ALTER COLUMN "quantity" TYPE DECIMAL(10, 3) USING "quantity"::DECIMAL(10, 3),
  ALTER COLUMN "quantity_received" TYPE DECIMAL(10, 3) USING "quantity_received"::DECIMAL(10, 3),
  ALTER COLUMN "quantity_invoiced" TYPE DECIMAL(10, 3) USING "quantity_invoiced"::DECIMAL(10, 3);

-- Composite unique constraint on purchase_order_items for tenant-scoped 1:1 reservation relation
CREATE UNIQUE INDEX "purchase_order_items_tenant_id_id_key"
  ON "purchase_order_items"("tenant_id", "id");

-- PurchaseInvoiceLine: widen quantity precision to DECIMAL(10,3)
ALTER TABLE "purchase_invoice_lines"
  ALTER COLUMN "quantity" TYPE DECIMAL(10, 3) USING "quantity"::DECIMAL(10, 3);

-- WorkshopTaskLineItem: widen quantity precision from scale 2 to scale 3
ALTER TABLE "workshop_task_line_items"
  ALTER COLUMN "quantity" TYPE DECIMAL(10, 3) USING "quantity"::DECIMAL(10, 3);

-- SalesOrderItem: widen quantity precision from scale 2 to scale 3
ALTER TABLE "sales_order_items"
  ALTER COLUMN "quantity" TYPE DECIMAL(10, 3) USING "quantity"::DECIMAL(10, 3);

-- InvoiceItem: widen quantity precision from scale 2 to scale 3
ALTER TABLE "invoice_items"
  ALTER COLUMN "quantity" TYPE DECIMAL(10, 3) USING "quantity"::DECIMAL(10, 3);

-- InventoryTransaction: add autoincrement seq and parts_reservation_id
ALTER TABLE "inventory_transactions"
  ADD COLUMN "seq" BIGSERIAL,
  ADD COLUMN "parts_reservation_id" TEXT;

CREATE UNIQUE INDEX "inventory_transactions_tenant_id_seq_key"
  ON "inventory_transactions"("tenant_id", "seq");

CREATE INDEX "inventory_transactions_seq_idx"
  ON "inventory_transactions"("seq");

-- PartsRequisition table
CREATE TABLE "parts_requisitions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "vehicle_make_brand_id" INTEGER NOT NULL,
  "status" "PartsRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "parts_requisitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parts_requisitions_tenant_id_id_key"
  ON "parts_requisitions"("tenant_id", "id");

CREATE INDEX "parts_requisitions_tenant_id_idx"
  ON "parts_requisitions"("tenant_id");

CREATE INDEX "parts_requisitions_tenant_id_vehicle_make_brand_id_idx"
  ON "parts_requisitions"("tenant_id", "vehicle_make_brand_id");

ALTER TABLE "parts_requisitions"
  ADD CONSTRAINT "parts_requisitions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "parts_requisitions"
  ADD CONSTRAINT "parts_requisitions_vehicle_make_brand_id_fkey"
  FOREIGN KEY ("vehicle_make_brand_id") REFERENCES "brands"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- PartsRequisitionLine table
CREATE TABLE "parts_requisition_lines" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "requisition_id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "parts_requisition_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parts_requisition_lines_tenant_id_id_key"
  ON "parts_requisition_lines"("tenant_id", "id");

CREATE INDEX "parts_requisition_lines_tenant_id_idx"
  ON "parts_requisition_lines"("tenant_id");

CREATE INDEX "parts_requisition_lines_requisition_id_idx"
  ON "parts_requisition_lines"("requisition_id");

ALTER TABLE "parts_requisition_lines"
  ADD CONSTRAINT "parts_requisition_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "parts_requisition_lines"
  ADD CONSTRAINT "parts_requisition_lines_requisition_id_fkey"
  FOREIGN KEY ("requisition_id") REFERENCES "parts_requisitions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- PartsReservation table
CREATE TABLE "parts_reservations" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "workshop_task_line_item_id" TEXT NOT NULL,
  "quantity" DECIMAL(10, 3) NOT NULL,
  "quantity_received" DECIMAL(10, 3) NOT NULL DEFAULT 0,
  "quantity_consumed" DECIMAL(10, 3) NOT NULL DEFAULT 0,
  "quantity_staged" DECIMAL(10, 3) NOT NULL DEFAULT 0,
  "quantity_returned" DECIMAL(10, 3) NOT NULL DEFAULT 0,
  "kind" "PartsReservationKind" NOT NULL,
  "status" "PartsReservationStatus" NOT NULL DEFAULT 'OPEN',
  "location_id" TEXT,
  "requisition_line_id" TEXT,
  "purchase_order_item_id" TEXT,
  "detached_at" TIMESTAMP(3),
  "tote_cost_basis" DECIMAL(10, 2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "parts_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parts_reservations_tenant_id_id_key"
  ON "parts_reservations"("tenant_id", "id");

CREATE UNIQUE INDEX "parts_reservations_tenant_id_requisition_line_id_key"
  ON "parts_reservations"("tenant_id", "requisition_line_id");

CREATE UNIQUE INDEX "parts_reservations_tenant_id_purchase_order_item_id_key"
  ON "parts_reservations"("tenant_id", "purchase_order_item_id");

CREATE INDEX "parts_reservations_tenant_id_idx"
  ON "parts_reservations"("tenant_id");

CREATE INDEX "parts_reservations_workshop_task_line_item_id_idx"
  ON "parts_reservations"("workshop_task_line_item_id");

CREATE INDEX "parts_reservations_location_id_idx"
  ON "parts_reservations"("location_id");

CREATE INDEX "parts_reservations_status_idx"
  ON "parts_reservations"("status");

ALTER TABLE "parts_reservations"
  ADD CONSTRAINT "parts_reservations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "parts_reservations"
  ADD CONSTRAINT "parts_reservations_workshop_task_line_item_id_fkey"
  FOREIGN KEY ("workshop_task_line_item_id") REFERENCES "workshop_task_line_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "parts_reservations"
  ADD CONSTRAINT "parts_reservations_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "storage_locations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "parts_reservations"
  ADD CONSTRAINT "parts_reservations_tenant_id_requisition_line_id_fkey"
  FOREIGN KEY ("tenant_id", "requisition_line_id") REFERENCES "parts_requisition_lines"("tenant_id", "id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "parts_reservations"
  ADD CONSTRAINT "parts_reservations_tenant_id_purchase_order_item_id_fkey"
  FOREIGN KEY ("tenant_id", "purchase_order_item_id") REFERENCES "purchase_order_items"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- InventoryTransaction foreign key to parts_reservations
ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_parts_reservation_id_fkey"
  FOREIGN KEY ("parts_reservation_id") REFERENCES "parts_reservations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
