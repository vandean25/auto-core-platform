-- Restore tenant-scoped composite FKs with Postgres 15 column-list ON DELETE SET NULL
ALTER TABLE "loaner_bookings" DROP CONSTRAINT IF EXISTS "loaner_bookings_workshop_order_id_fkey";
ALTER TABLE "loaner_bookings" DROP CONSTRAINT IF EXISTS "loaner_bookings_licence_checked_by_id_fkey";

ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE SET NULL ("workshop_order_id") ON UPDATE CASCADE;

ALTER TABLE "loaner_bookings" ADD CONSTRAINT "loaner_bookings_tenant_id_licence_checked_by_id_fkey" FOREIGN KEY ("tenant_id", "licence_checked_by_id") REFERENCES "employees"("tenant_id", "id") ON DELETE SET NULL ("licence_checked_by_id") ON UPDATE CASCADE;
