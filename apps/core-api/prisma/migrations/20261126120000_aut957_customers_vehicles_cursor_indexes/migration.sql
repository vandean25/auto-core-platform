-- AUT-957: additive B-tree indexes for ADR-0035 customer and customer-vehicle cursor sorts (createdAt, id tiebreaker).

CREATE INDEX IF NOT EXISTS "customers_tenant_id_createdAt_id_idx"
  ON "customers" ("tenant_id", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "vehicles_tenant_id_createdAt_id_idx"
  ON "vehicles" ("tenant_id", "createdAt", "id");
