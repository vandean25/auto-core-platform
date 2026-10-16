-- One row per (tenant_id, preset_key) when site_id IS NULL; site rows stay distinct.
DROP INDEX IF EXISTS "workshop_command_presets_tenant_id_preset_key_tenantwide_key";
DROP INDEX IF EXISTS "workshop_command_presets_tenant_id_preset_key_site_id_key";

CREATE UNIQUE INDEX "workshop_command_presets_tenant_id_preset_key_site_id_key"
ON "workshop_command_presets" ("tenant_id", "preset_key", "site_id") NULLS NOT DISTINCT;
