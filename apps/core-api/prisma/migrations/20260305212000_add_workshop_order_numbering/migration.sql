-- AlterTable
ALTER TABLE "finance_settings"
ADD COLUMN "next_workshop_order_number" INTEGER NOT NULL DEFAULT 1001,
ADD COLUMN "workshop_order_prefix" TEXT NOT NULL DEFAULT 'WO-2026-';

-- AlterTable
ALTER TABLE "workshop_orders" ADD COLUMN "order_number" TEXT;

-- Backfill order numbers for existing rows using year-scoped sequence by createdAt
WITH numbered AS (
  SELECT
    id,
    'WO-' ||
    EXTRACT(YEAR FROM "createdAt")::TEXT ||
    '-' ||
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY EXTRACT(YEAR FROM "createdAt")
        ORDER BY "createdAt", id
      )::TEXT,
      4,
      '0'
    ) AS order_number
  FROM "workshop_orders"
)
UPDATE "workshop_orders" wo
SET "order_number" = numbered.order_number
FROM numbered
WHERE wo.id = numbered.id;

-- AlterTable
ALTER TABLE "workshop_orders" ALTER COLUMN "order_number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "workshop_orders_order_number_key" ON "workshop_orders"("order_number");
