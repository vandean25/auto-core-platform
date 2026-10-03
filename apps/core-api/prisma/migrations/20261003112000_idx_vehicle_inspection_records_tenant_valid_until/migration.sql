-- CreateIndex
CREATE INDEX "idx_vehicle_inspection_records_tenant_valid_until" ON "public"."vehicle_inspection_records"("tenant_id", "plaketten_valid_until_year", "plaketten_valid_until_month");
