-- Tenant-scoped customer reference for loaner bookings
CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_id_id_key" ON "customers"("tenant_id", "id");

ALTER TABLE "loaner_bookings" DROP CONSTRAINT IF EXISTS "loaner_bookings_customer_id_fkey";
ALTER TABLE "loaner_bookings" DROP CONSTRAINT IF EXISTS "loaner_bookings_tenant_id_workshop_order_id_fkey";
ALTER TABLE "loaner_bookings" DROP CONSTRAINT IF EXISTS "loaner_bookings_tenant_id_licence_checked_by_id_fkey";

ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_workshop_order_id_fkey" FOREIGN KEY ("workshop_order_id") REFERENCES "workshop_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_licence_checked_by_id_fkey" FOREIGN KEY ("licence_checked_by_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "loaner_bookings_one_handed_over_per_vehicle" ON "loaner_bookings"("tenant_id", "loaner_vehicle_id") WHERE ("status" = 'HANDED_OVER');
