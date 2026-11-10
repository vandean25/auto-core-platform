-- AUT-928: catalog_items revision sequence + inventory_price_operations journal storage

CREATE SEQUENCE catalog_item_revision_seq;

ALTER TABLE "catalog_items" ADD COLUMN "revision" BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION set_catalog_item_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.revision := nextval('catalog_item_revision_seq');
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalog_items_set_revision
BEFORE INSERT OR UPDATE ON "catalog_items"
FOR EACH ROW
EXECUTE FUNCTION set_catalog_item_revision();

-- Existing rows received DEFAULT 0 without firing the insert trigger; bump each via UPDATE.
UPDATE "catalog_items" SET "revision" = "revision";

CREATE TYPE "InventoryPriceOperationState" AS ENUM ('ACCEPTED', 'APPLIED', 'CONFLICT', 'FENCED');

CREATE TABLE "inventory_price_operations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "key" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expected_revision" BIGINT NOT NULL,
    "target_minor" BIGINT NOT NULL,
    "basis_minor" BIGINT NOT NULL,
    "state" "InventoryPriceOperationState" NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL,
    "final_at" TIMESTAMP(3),
    "result_revision" BIGINT,
    "error_code" TEXT,

    CONSTRAINT "inventory_price_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_price_operations_tenant_id_id_key" ON "inventory_price_operations"("tenant_id", "id");

CREATE UNIQUE INDEX "inventory_price_operations_tenant_id_principal_id_key_key" ON "inventory_price_operations"("tenant_id", "principal_id", "key");

-- Intentional partial unique index (not representable in Prisma schema). Do not drop in drift migrations.
CREATE UNIQUE INDEX "inventory_price_operations_one_accepted_per_principal_item"
  ON "inventory_price_operations" ("tenant_id", "principal_id", "item_id")
  WHERE "state" = 'ACCEPTED';

CREATE INDEX "inventory_price_operations_state_accepted_at_idx" ON "inventory_price_operations"("state", "accepted_at");

ALTER TABLE "inventory_price_operations" ADD CONSTRAINT "inventory_price_operations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
