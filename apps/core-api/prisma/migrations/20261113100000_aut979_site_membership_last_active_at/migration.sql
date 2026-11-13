-- AUT-979: remember the last active site per tenant so a tenant switch can restore it.
ALTER TABLE "site_memberships" ADD COLUMN "last_active_at" TIMESTAMP(3);

-- Backfill: the site a user has active today counts as their last active site in that tenant.
UPDATE "site_memberships" AS sm
SET "last_active_at" = CURRENT_TIMESTAMP
FROM "users" AS u
WHERE u."id" = sm."user_id"
  AND u."active_tenant_id" = sm."tenant_id"
  AND u."active_site_id" = sm."site_id";
