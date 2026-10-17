-- AUT-569: advisor-confirmed mobile.de export assertions (expand-only, tenant-scoped listing row).
ALTER TABLE "vehicle_listings" ADD COLUMN "portal_category" VARCHAR(64);
ALTER TABLE "vehicle_listings" ADD COLUMN "export_assertion_damage_free" BOOLEAN;
ALTER TABLE "vehicle_listings" ADD COLUMN "export_assertion_metallic" BOOLEAN;
ALTER TABLE "vehicle_listings" ADD COLUMN "export_assertion_guarantee" BOOLEAN;
ALTER TABLE "vehicle_listings" ADD COLUMN "export_assertion_jahreswagen" BOOLEAN;
ALTER TABLE "vehicle_listings" ADD COLUMN "export_assertion_recommendation" BOOLEAN;
ALTER TABLE "vehicle_listings" ADD COLUMN "export_assertion_demo_vehicle" BOOLEAN;
