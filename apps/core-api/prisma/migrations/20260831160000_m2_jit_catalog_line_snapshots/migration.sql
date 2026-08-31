-- M2 JIT parts & labor snapshot schema (AUT-237 / DB-2)

-- CatalogItem: external identity fields and nullable cost
ALTER TABLE "catalog_items"
ADD COLUMN "source_system" TEXT,
ADD COLUMN "external_article_id" TEXT,
ADD COLUMN "ean" TEXT,
ADD COLUMN "oem_numbers" JSONB;

ALTER TABLE "catalog_items"
ALTER COLUMN "cost_price" DROP NOT NULL;

-- WorkshopTask: optimistic concurrency for line-item mutations
ALTER TABLE "workshop_tasks"
ADD COLUMN "line_items_version" INTEGER NOT NULL DEFAULT 0;

-- WorkshopTaskLineItem: catalog/labor snapshots and JIT idempotency
ALTER TABLE "workshop_task_line_items"
ADD COLUMN "catalog_item_id" TEXT,
ADD COLUMN "source_system" TEXT,
ADD COLUMN "external_operation_code" TEXT,
ADD COLUMN "fitment_notes" TEXT,
ADD COLUMN "cost_price_est" DECIMAL(10,2),
ADD COLUMN "oem_numbers" JSONB,
ADD COLUMN "labor_category_id" UUID,
ADD COLUMN "hourly_rate_snapshot" DECIMAL(10,2),
ADD COLUMN "catalog_hit_jti" TEXT;

-- LaborCategory: default internal cost rate for snapshotting
ALTER TABLE "labor_categories"
ADD COLUMN "default_internal_cost_rate" DECIMAL(10,2);

-- Indexes and foreign keys
CREATE INDEX "workshop_task_line_items_catalog_item_id_idx"
  ON "workshop_task_line_items"("catalog_item_id");

CREATE INDEX "workshop_task_line_items_labor_category_id_idx"
  ON "workshop_task_line_items"("labor_category_id");

ALTER TABLE "workshop_task_line_items"
ADD CONSTRAINT "workshop_task_line_items_catalog_item_id_fkey"
  FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workshop_task_line_items"
ADD CONSTRAINT "workshop_task_line_items_labor_category_id_fkey"
  FOREIGN KEY ("labor_category_id") REFERENCES "labor_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique: one JIT catalog row per external article per source per tenant
CREATE UNIQUE INDEX "catalog_items_tenant_id_source_system_external_article_id_key"
  ON "catalog_items"("tenant_id", "source_system", "external_article_id")
  WHERE "source_system" IS NOT NULL AND "external_article_id" IS NOT NULL;

-- Partial unique: one line per catalog hit token per task (manual lines keep null jti)
CREATE UNIQUE INDEX "workshop_task_line_items_tenant_id_workshop_task_id_catalog_hit_jti_key"
  ON "workshop_task_line_items"("tenant_id", "workshop_task_id", "catalog_hit_jti")
  WHERE "catalog_hit_jti" IS NOT NULL;
