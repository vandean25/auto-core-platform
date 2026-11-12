-- Backfill purchase_order_sequences from existing PO-YYYY-NNNN rows.
INSERT INTO "purchase_order_sequences" ("id", "tenant_id", "year", "current")
SELECT
  gen_random_uuid()::text,
  tenant_id,
  CAST(SUBSTRING(order_number FROM 4 FOR 4) AS INTEGER) AS year,
  MAX(CAST(SUBSTRING(order_number FROM 9 FOR 4) AS INTEGER)) AS current
FROM "purchase_orders"
WHERE order_number ~ '^PO-[0-9]{4}-[0-9]{4}$'
GROUP BY tenant_id, CAST(SUBSTRING(order_number FROM 4 FOR 4) AS INTEGER)
ON CONFLICT ("tenant_id", "year")
DO UPDATE SET "current" = GREATEST(
  "purchase_order_sequences"."current",
  EXCLUDED."current"
);

CREATE INDEX IF NOT EXISTS "inventory_price_operations_discovery_idx"
  ON "inventory_price_operations" ("tenant_id", "principal_id", "accepted_at" DESC, "key" DESC);
