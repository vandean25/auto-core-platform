-- AlterTable
ALTER TABLE "inventory_transactions" ALTER COLUMN "cost_basis" TYPE DECIMAL(12,4);

-- CreateTable
CREATE TABLE "inventory_valuations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "catalog_item_id" TEXT NOT NULL,
    "average_unit_cost" DECIMAL(12,4),
    "valued_quantity" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "as_of" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_booking_seq" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_valuations_tenant_id_idx" ON "inventory_valuations"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_valuations_tenant_id_legal_entity_id_idx" ON "inventory_valuations"("tenant_id", "legal_entity_id");

-- CreateIndex
CREATE INDEX "inventory_valuations_tenant_id_catalog_item_id_idx" ON "inventory_valuations"("tenant_id", "catalog_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_valuations_tenant_id_legal_entity_id_catalog_item_key" ON "inventory_valuations"("tenant_id", "legal_entity_id", "catalog_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_tenant_id_id_key" ON "catalog_items"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "inventory_valuations" ADD CONSTRAINT "inventory_valuations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuations" ADD CONSTRAINT "inventory_valuations_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuations" ADD CONSTRAINT "inventory_valuations_tenant_id_catalog_item_id_fkey" FOREIGN KEY ("tenant_id", "catalog_item_id") REFERENCES "catalog_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
