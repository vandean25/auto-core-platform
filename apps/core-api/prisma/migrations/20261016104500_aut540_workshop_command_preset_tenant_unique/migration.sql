-- AUT-540: at most one tenant-wide preset per (tenant_id, preset_key)
CREATE UNIQUE INDEX "workshop_command_presets_tenant_id_preset_key_tenantwide_key"
ON "workshop_command_presets" ("tenant_id", "preset_key")
WHERE "site_id" IS NULL;
