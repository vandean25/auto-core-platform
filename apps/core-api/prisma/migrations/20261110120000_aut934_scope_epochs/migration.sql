-- AUT-934: ADR-0038 §2 scope and authorization epochs
ALTER TABLE "tenant_members" ADD COLUMN "scope_epoch" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "tenants" ADD COLUMN "authorization_epoch" BIGINT NOT NULL DEFAULT 0;
