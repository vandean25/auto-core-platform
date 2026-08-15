-- Tenant-composite 1:1 Invoice → VehicleSale, matching sales_order / workshop_order.
CREATE UNIQUE INDEX "vehicle_sales_tenant_id_id_key" ON "vehicle_sales"("tenant_id", "id");

DROP INDEX "invoices_vehicle_sale_id_key";

ALTER TABLE "invoices" DROP CONSTRAINT "invoices_vehicle_sale_id_fkey";

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_vehicle_sale_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_sale_id") REFERENCES "vehicle_sales"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
