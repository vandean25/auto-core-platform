-- AUT-250: same-GmbH stock transfers with in-transit.
-- Adds the StockTransfer document (request -> approve -> ship -> receive),
-- per-line immutable site copies with site-safe composite FKs, durable
-- idempotency command rows, finance settings numbering columns, and the
-- movement_group_id / stock_transfer_id columns on the ledger.

BEGIN;

-- Enum types ---------------------------------------------------------------

CREATE TYPE "StockTransferStatus" AS ENUM (
  'REQUESTED',
  'APPROVED',
  'SHIPPED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE "StockTransferCommandAction" AS ENUM ('RECEIVE', 'RETURN');

-- finance_settings numbering columns (ruling 52/57) ------------------------

ALTER TABLE "finance_settings" ADD COLUMN "next_stock_transfer_number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "finance_settings" ADD COLUMN "stock_transfer_prefix" TEXT NOT NULL DEFAULT 'TR-2026-';

-- Ledger columns -----------------------------------------------------------

ALTER TABLE "inventory_transactions" ADD COLUMN "movement_group_id" TEXT;
ALTER TABLE "inventory_transactions" ADD COLUMN "stock_transfer_id" TEXT;
CREATE INDEX "inventory_transactions_movement_group_id_idx" ON "inventory_transactions"("movement_group_id");

-- stock_transfers ----------------------------------------------------------

CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "from_site_id" TEXT NOT NULL,
    "to_site_id" TEXT NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "requested_by_user_id" TEXT NOT NULL,
    "approved_by_user_id" TEXT,
    "shipped_by_user_id" TEXT,
    "received_by_user_id" TEXT,
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfers_tenant_id_id_key" ON "stock_transfers"("tenant_id", "id");
CREATE UNIQUE INDEX "stock_transfers_tenant_id_id_from_site_id_to_site_id_key" ON "stock_transfers"("tenant_id", "id", "from_site_id", "to_site_id");
CREATE UNIQUE INDEX "stock_transfers_tenant_id_transfer_number_key" ON "stock_transfers"("tenant_id", "transfer_number");
CREATE INDEX "stock_transfers_tenant_id_idx" ON "stock_transfers"("tenant_id");
CREATE INDEX "stock_transfers_tenant_id_from_site_id_idx" ON "stock_transfers"("tenant_id", "from_site_id");
CREATE INDEX "stock_transfers_tenant_id_to_site_id_idx" ON "stock_transfers"("tenant_id", "to_site_id");

-- stock_transfer_lines -----------------------------------------------------

CREATE TABLE "stock_transfer_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "from_site_id" TEXT NOT NULL,
    "to_site_id" TEXT NOT NULL,
    "catalog_item_id" TEXT NOT NULL,
    "source_location_id" TEXT,
    "dest_location_id" TEXT,
    "requested_qty" DECIMAL(10,3) NOT NULL,
    "approved_qty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "shipped_qty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "received_qty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "returned_qty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfer_lines_tenant_id_id_key" ON "stock_transfer_lines"("tenant_id", "id");
CREATE INDEX "stock_transfer_lines_tenant_id_transfer_id_idx" ON "stock_transfer_lines"("tenant_id", "transfer_id");

-- stock_transfer_commands --------------------------------------------------

CREATE TABLE "stock_transfer_commands" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "action" "StockTransferCommandAction" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfer_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfer_commands_tenant_id_transfer_id_action_idempo_key" ON "stock_transfer_commands"("tenant_id", "transfer_id", "action", "idempotency_key");
CREATE INDEX "stock_transfer_commands_tenant_id_transfer_id_idx" ON "stock_transfer_commands"("tenant_id", "transfer_id");

-- Foreign keys -------------------------------------------------------------

ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_tenant_id_from_site_id_fkey"
    FOREIGN KEY ("tenant_id", "from_site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_tenant_id_to_site_id_fkey"
    FOREIGN KEY ("tenant_id", "to_site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_approved_by_user_id_fkey"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_shipped_by_user_id_fkey"
    FOREIGN KEY ("shipped_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_received_by_user_id_fkey"
    FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_lines"
    ADD CONSTRAINT "stock_transfer_lines_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_lines"
    ADD CONSTRAINT "stock_transfer_lines_tenant_id_transfer_id_from_site_id_to_fkey"
    FOREIGN KEY ("tenant_id", "transfer_id", "from_site_id", "to_site_id") REFERENCES "stock_transfers"("tenant_id", "id", "from_site_id", "to_site_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_lines"
    ADD CONSTRAINT "stock_transfer_lines_catalog_item_id_fkey"
    FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_lines"
    ADD CONSTRAINT "stock_transfer_lines_tenant_id_from_site_id_source_locatio_fkey"
    FOREIGN KEY ("tenant_id", "from_site_id", "source_location_id") REFERENCES "storage_locations"("tenant_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_lines"
    ADD CONSTRAINT "stock_transfer_lines_tenant_id_to_site_id_dest_location_id_fkey"
    FOREIGN KEY ("tenant_id", "to_site_id", "dest_location_id") REFERENCES "storage_locations"("tenant_id", "site_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_commands"
    ADD CONSTRAINT "stock_transfer_commands_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_commands"
    ADD CONSTRAINT "stock_transfer_commands_tenant_id_transfer_id_fkey"
    FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "stock_transfers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_transactions"
    ADD CONSTRAINT "inventory_transactions_tenant_id_stock_transfer_id_fkey"
    FOREIGN KEY ("tenant_id", "stock_transfer_id") REFERENCES "stock_transfers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
