-- AUT-566: vehicle equipment taxonomy and selections

CREATE TABLE "vehicle_equipment_options" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "label_de" VARCHAR(120) NOT NULL,
    "label_en" VARCHAR(120) NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_equipment_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_equipment_options_tenant_id_code_key" ON "vehicle_equipment_options"("tenant_id", "code");
CREATE UNIQUE INDEX "vehicle_equipment_options_tenant_id_id_key" ON "vehicle_equipment_options"("tenant_id", "id");
CREATE INDEX "vehicle_equipment_options_tenant_id_active_category_idx" ON "vehicle_equipment_options"("tenant_id", "active", "category");

CREATE TABLE "vehicle_equipment_selections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_equipment_selections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_equipment_selections_tenant_id_vehicle_id_option_id_key" ON "vehicle_equipment_selections"("tenant_id", "vehicle_id", "option_id");
CREATE UNIQUE INDEX "vehicle_equipment_selections_tenant_id_id_key" ON "vehicle_equipment_selections"("tenant_id", "id");
CREATE INDEX "vehicle_equipment_selections_tenant_id_vehicle_id_idx" ON "vehicle_equipment_selections"("tenant_id", "vehicle_id");

CREATE TABLE "vehicle_equipment_free_text_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_equipment_free_text_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_equipment_free_text_items_tenant_id_id_key" ON "vehicle_equipment_free_text_items"("tenant_id", "id");
CREATE INDEX "vehicle_equipment_free_text_items_tenant_id_vehicle_id_sort_order_idx" ON "vehicle_equipment_free_text_items"("tenant_id", "vehicle_id", "sort_order");

ALTER TABLE "vehicle_equipment_options" ADD CONSTRAINT "vehicle_equipment_options_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_equipment_selections" ADD CONSTRAINT "vehicle_equipment_selections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_equipment_selections" ADD CONSTRAINT "vehicle_equipment_selections_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_equipment_selections" ADD CONSTRAINT "vehicle_equipment_selections_tenant_id_option_id_fkey" FOREIGN KEY ("tenant_id", "option_id") REFERENCES "vehicle_equipment_options"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_equipment_free_text_items" ADD CONSTRAINT "vehicle_equipment_free_text_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_equipment_free_text_items" ADD CONSTRAINT "vehicle_equipment_free_text_items_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
