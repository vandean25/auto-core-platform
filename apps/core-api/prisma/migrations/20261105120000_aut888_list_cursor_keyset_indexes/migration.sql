-- AUT-888: additive B-tree indexes for ADR-0035 keyset list sorts (pilot: inventory + vehicle stock).

CREATE INDEX IF NOT EXISTS "catalog_items_tenant_id_sku_id_idx"
  ON "catalog_items" ("tenant_id", "sku", "id");

CREATE INDEX IF NOT EXISTS "catalog_items_tenant_id_name_id_idx"
  ON "catalog_items" ("tenant_id", "name", "id");

CREATE INDEX IF NOT EXISTS "catalog_items_tenant_id_retail_price_id_idx"
  ON "catalog_items" ("tenant_id", "retail_price", "id");

CREATE INDEX IF NOT EXISTS "vehicles_tenant_id_site_id_year_id_idx"
  ON "vehicles" ("tenant_id", "site_id", "year", "id");

CREATE INDEX IF NOT EXISTS "vehicles_tenant_id_site_id_updatedAt_id_idx"
  ON "vehicles" ("tenant_id", "site_id", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "vehicles_tenant_id_site_id_make_id_idx"
  ON "vehicles" ("tenant_id", "site_id", "make", "id");

CREATE INDEX IF NOT EXISTS "vehicles_tenant_id_site_id_model_id_idx"
  ON "vehicles" ("tenant_id", "site_id", "model", "id");

CREATE INDEX IF NOT EXISTS "vehicles_tenant_id_site_id_plate_id_idx"
  ON "vehicles" ("tenant_id", "site_id", "plate", "id");

CREATE INDEX IF NOT EXISTS "vehicles_tenant_id_site_id_vin_id_idx"
  ON "vehicles" ("tenant_id", "site_id", "vin", "id");

CREATE INDEX IF NOT EXISTS "vehicles_tenant_id_site_id_color_id_idx"
  ON "vehicles" ("tenant_id", "site_id", "color", "id");
