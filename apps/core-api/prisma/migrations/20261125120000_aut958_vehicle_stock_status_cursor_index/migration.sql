-- AUT-958: additive B-tree index for ADR-0035 vehicle stock_status keyset cursor sort.

CREATE INDEX IF NOT EXISTS "vehicles_tenant_id_site_id_stock_status_id_idx"
  ON "vehicles" ("tenant_id", "site_id", "stock_status", "id");
