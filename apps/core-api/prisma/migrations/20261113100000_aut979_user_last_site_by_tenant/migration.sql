-- AUT-979: remember the last active site per tenant so a tenant switch can restore it.
ALTER TABLE "users" ADD COLUMN "last_site_by_tenant" JSONB;

-- Backfill: the site a user has active today counts as their last site in that tenant.
UPDATE "users"
SET "last_site_by_tenant" = jsonb_build_object("active_tenant_id", "active_site_id")
WHERE "active_tenant_id" IS NOT NULL
  AND "active_site_id" IS NOT NULL;
