-- Prevent tyre set hard-delete from wiping append-only event ledger
ALTER TABLE "tyre_set_events" DROP CONSTRAINT "tyre_set_events_tenant_id_tyre_set_id_fkey";

ALTER TABLE "tyre_set_events" ADD CONSTRAINT "tyre_set_events_tenant_id_tyre_set_id_fkey" FOREIGN KEY ("tenant_id", "tyre_set_id") REFERENCES "tyre_sets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
