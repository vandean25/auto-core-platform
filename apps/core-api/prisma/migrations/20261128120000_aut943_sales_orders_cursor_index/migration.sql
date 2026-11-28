-- AUT-943: additive B-tree index for the ADR-0035 sales order cursor sort (createdAt, id tiebreaker).

CREATE INDEX IF NOT EXISTS "sales_orders_tenant_id_site_id_createdAt_id_idx"
  ON "sales_orders" ("tenant_id", "site_id", "createdAt", "id");
