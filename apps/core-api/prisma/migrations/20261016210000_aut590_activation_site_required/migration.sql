-- Require site_id on catalogue activations (site-scoped activation in v1).
DELETE FROM "tenant_inspection_catalogue_activations" WHERE "site_id" IS NULL;

ALTER TABLE "tenant_inspection_catalogue_activations"
  ALTER COLUMN "site_id" SET NOT NULL;
