-- AUT-533: composite vehicle foreign keys (tenant_id, vehicle_id) -> vehicles(tenant_id, id)

ALTER TABLE "inspection_report_identities" DROP CONSTRAINT "inspection_report_identities_vehicle_id_fkey";
ALTER TABLE "inspection_report_identities" ADD CONSTRAINT "inspection_report_identities_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_exchange_imports" DROP CONSTRAINT "inspection_exchange_imports_vehicle_id_fkey";
ALTER TABLE "inspection_exchange_imports" ADD CONSTRAINT "inspection_exchange_imports_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "external_inspection_results" DROP CONSTRAINT "external_inspection_results_vehicle_id_fkey";
ALTER TABLE "external_inspection_results" ADD CONSTRAINT "external_inspection_results_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
