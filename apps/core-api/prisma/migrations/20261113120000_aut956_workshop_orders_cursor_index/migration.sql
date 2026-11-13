-- AUT-956: additive B-tree index for the ADR-0035 workshop order cursor sort (createdAt, id tiebreaker).

CREATE INDEX IF NOT EXISTS "workshop_orders_tenant_id_site_id_createdAt_id_idx"
  ON "workshop_orders" ("tenant_id", "site_id", "createdAt", "id");
