-- AUT-566: per-cycle equipment, present/absent assertions, backfill starter taxonomy

CREATE TYPE "VehicleEquipmentAssertion" AS ENUM ('PRESENT', 'ABSENT');

DELETE FROM "vehicle_equipment_selections";
DELETE FROM "vehicle_equipment_free_text_items";

DROP INDEX IF EXISTS "vehicle_equipment_selections_tenant_id_vehicle_id_option_id_key";

ALTER TABLE "vehicle_equipment_selections" ADD COLUMN "stock_purchase_id" TEXT;
ALTER TABLE "vehicle_equipment_selections" ADD COLUMN "assertion" "VehicleEquipmentAssertion";

ALTER TABLE "vehicle_equipment_free_text_items" ADD COLUMN "stock_purchase_id" TEXT;

ALTER TABLE "vehicle_equipment_selections" ALTER COLUMN "stock_purchase_id" SET NOT NULL;
ALTER TABLE "vehicle_equipment_selections" ALTER COLUMN "assertion" SET NOT NULL;

ALTER TABLE "vehicle_equipment_free_text_items" ALTER COLUMN "stock_purchase_id" SET NOT NULL;

CREATE UNIQUE INDEX "vehicle_equipment_selections_tenant_id_stock_purchase_id_option_id_key" ON "vehicle_equipment_selections"("tenant_id", "stock_purchase_id", "option_id");

CREATE INDEX "vehicle_equipment_selections_tenant_id_stock_purchase_id_idx" ON "vehicle_equipment_selections"("tenant_id", "stock_purchase_id");

CREATE INDEX "vehicle_equipment_free_text_items_tenant_id_stock_purchase_id_sort_order_idx" ON "vehicle_equipment_free_text_items"("tenant_id", "stock_purchase_id", "sort_order");

ALTER TABLE "vehicle_equipment_selections" ADD CONSTRAINT "vehicle_equipment_selections_tenant_id_stock_purchase_id_fkey" FOREIGN KEY ("tenant_id", "stock_purchase_id") REFERENCES "vehicle_purchases"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vehicle_equipment_free_text_items" ADD CONSTRAINT "vehicle_equipment_free_text_items_tenant_id_stock_purchase_id_fkey" FOREIGN KEY ("tenant_id", "stock_purchase_id") REFERENCES "vehicle_purchases"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "vehicle_equipment_options" ("id", "tenant_id", "code", "label_de", "label_en", "category", "active", "created_at", "updated_at")
SELECT gen_random_uuid(), t."id", s.code, s.label_de, s.label_en, s.category, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('ABS', 'ABS', 'ABS', 'SAFETY'),
    ('ESP', 'ESP', 'ESP', 'SAFETY'),
    ('ISOFIX', 'ISOFIX', 'ISOFIX child seat anchors', 'SAFETY'),
    ('AIR_CONDITIONING', 'Klimaanlage', 'Air conditioning', 'COMFORT'),
    ('AUTOMATIC_CLIMATE', 'Klimaautomatik', 'Automatic climate control', 'COMFORT'),
    ('SEAT_HEATING', 'Sitzheizung', 'Seat heating', 'COMFORT'),
    ('CRUISE_CONTROL', 'Tempomat', 'Cruise control', 'COMFORT'),
    ('BLUETOOTH', 'Bluetooth', 'Bluetooth', 'COMFORT'),
    ('NAVIGATION', 'Navigationssystem', 'Navigation system', 'COMFORT'),
    ('ALLOY_WHEELS', 'Leichtmetallfelgen', 'Alloy wheels', 'EXTERIOR'),
    ('TOW_BAR', 'Anhängerkupplung', 'Tow bar', 'EXTERIOR'),
    ('PARKING_FRONT', 'Einparkhilfe vorne', 'Front parking sensors', 'PARKING'),
    ('PARKING_REAR', 'Einparkhilfe hinten', 'Rear parking sensors', 'PARKING'),
    ('PARKING_CAMERA', 'Rückfahrkamera', 'Rear view camera', 'PARKING')
) AS s(code, label_de, label_en, category)
ON CONFLICT ("tenant_id", "code") DO NOTHING;
