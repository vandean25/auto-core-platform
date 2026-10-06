ALTER TABLE "vehicles"
  ADD COLUMN "stock_received_at" TIMESTAMP(3),
  ADD COLUMN "stock_cost_basis" DECIMAL(12,2);

ALTER TABLE "vehicle_sales"
  ADD COLUMN "days_to_sell_snapshot" INTEGER;

WITH active_stock AS (
  SELECT
    vehicle."id",
    vehicle."tenant_id",
    COALESCE(purchase."received_at", purchase_entry."posting_date") AS stock_received_at,
    purchase."id" AS vehicle_purchase_id
  FROM "vehicles" vehicle
  LEFT JOIN LATERAL (
    SELECT "id", "received_at"
    FROM "vehicle_purchases"
    WHERE "tenant_id" = vehicle."tenant_id"
      AND "vehicle_id" = vehicle."id"
      AND "status" = 'RECEIVED'
      AND "received_at" IS NOT NULL
    ORDER BY "received_at" DESC, "createdAt" DESC
    LIMIT 1
  ) purchase ON TRUE
  LEFT JOIN LATERAL (
    SELECT "posting_date"
    FROM "vehicle_ledger_entries"
    WHERE "tenant_id" = vehicle."tenant_id"
      AND "vehicle_id" = vehicle."id"
      AND "entry_type" = 'PURCHASE'
    ORDER BY "posting_date" DESC, "createdAt" DESC
    LIMIT 1
  ) purchase_entry ON TRUE
  WHERE vehicle."inventory_role" IN ('USED', 'NEW', 'DEMO')
    AND vehicle."stock_status" IS NOT NULL
)
UPDATE "vehicles" vehicle
SET
  "stock_received_at" = active_stock.stock_received_at,
  "stock_cost_basis" = COALESCE((
    SELECT SUM(entry."amount")
    FROM "vehicle_ledger_entries" entry
    WHERE entry."tenant_id" = active_stock."tenant_id"
      AND entry."vehicle_id" = active_stock."id"
      AND entry."entry_type" IN ('PURCHASE', 'WORKSHOP_COST', 'ADJUSTMENT')
      AND (
        active_stock.stock_received_at IS NULL
        OR entry."posting_date" >= active_stock.stock_received_at
      )
      AND (
        entry."entry_type" <> 'PURCHASE'
        OR active_stock.vehicle_purchase_id IS NULL
        OR entry."vehicle_purchase_id" = active_stock.vehicle_purchase_id
      )
  ), 0)
FROM active_stock
WHERE vehicle."id" = active_stock."id"
  AND vehicle."tenant_id" = active_stock."tenant_id";

CREATE INDEX "vehicles_tenant_id_site_id_stock_received_at_idx"
  ON "vehicles"("tenant_id", "site_id", "stock_received_at");

UPDATE "vehicle_sales" sale
SET "days_to_sell_snapshot" = GREATEST(0, invoice."date"::date - COALESCE(
  (
    SELECT purchase."received_at"
    FROM "vehicle_purchases" purchase
    WHERE purchase."tenant_id" = sale."tenant_id"
      AND purchase."vehicle_id" = sale."vehicle_id"
      AND purchase."status" = 'RECEIVED'
      AND purchase."received_at" <= invoice."date"
    ORDER BY purchase."received_at" DESC, purchase."createdAt" DESC
    LIMIT 1
  ),
  (
    SELECT entry."posting_date"
    FROM "vehicle_ledger_entries" entry
    WHERE entry."tenant_id" = sale."tenant_id"
      AND entry."vehicle_id" = sale."vehicle_id"
      AND entry."entry_type" = 'PURCHASE'
      AND entry."posting_date" <= invoice."date"
    ORDER BY entry."posting_date" DESC, entry."createdAt" DESC
    LIMIT 1
  )
)::date)::integer
FROM "invoices" invoice
WHERE invoice."tenant_id" = sale."tenant_id"
  AND invoice."vehicle_sale_id" = sale."id"
  AND invoice."status" = 'FINALIZED';
