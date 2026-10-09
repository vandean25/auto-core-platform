-- AUT-443 (E4 trade-in phase B): expand-only.
-- Adds the trade-in purchase identity column and the sale -> trade-in purchase link.
-- Reverse (if ever needed): DROP CONSTRAINT vehicle_sales_tenant_id_trade_in_purchase_id_fkey;
--   DROP INDEX vehicle_sales_tenant_id_trade_in_purchase_id_idx;
--   DROP INDEX vehicle_purchases_tenant_id_id_key;
--   ALTER TABLE vehicle_purchases DROP COLUMN first_registration_date;

-- AlterTable
ALTER TABLE "vehicle_purchases" ADD COLUMN "first_registration_date" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_purchases_tenant_id_id_key" ON "vehicle_purchases"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "vehicle_sales_tenant_id_trade_in_purchase_id_idx" ON "vehicle_sales"("tenant_id", "trade_in_purchase_id");

-- AddForeignKey
ALTER TABLE "vehicle_sales" ADD CONSTRAINT "vehicle_sales_tenant_id_trade_in_purchase_id_fkey" FOREIGN KEY ("tenant_id", "trade_in_purchase_id") REFERENCES "vehicle_purchases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
