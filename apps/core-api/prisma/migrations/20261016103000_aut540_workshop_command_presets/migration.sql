-- AUT-540: tenant/site presets for command-first workshop position plans
CREATE TABLE "workshop_command_presets" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" UUID,
    "preset_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "labor_operation_id" UUID,
    "catalog_item_id" TEXT,
    "duration_minutes" INTEGER,
    "quantity_milli" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_command_presets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workshop_command_presets_tenant_id_preset_key_site_id_key"
ON "workshop_command_presets"("tenant_id", "preset_key", "site_id");

CREATE INDEX "workshop_command_presets_tenant_id_active_idx"
ON "workshop_command_presets"("tenant_id", "active");

ALTER TABLE "workshop_command_presets"
ADD CONSTRAINT "workshop_command_presets_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
