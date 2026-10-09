-- AUT-411: tenant API keys for the read-only public API (ADR-0026). Expand-only.
-- Adds one enum value, nullable and defaulted columns, and one new table. No existing row is rewritten.

-- Public API requests are audited as agent-action rows with this actor type.
ALTER TYPE "AgentActionLogActorType" ADD VALUE 'API_KEY';

-- Identifier of the TenantApiKey that made the request (never the secret).
ALTER TABLE "agent_action_logs" ADD COLUMN "api_key_id" TEXT;

-- Per-key request budget per one-minute window. Defaulted, so existing tenants keep 60/min.
ALTER TABLE "tenants" ADD COLUMN "api_rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_api_rate_limit_per_minute_check"
  CHECK ("api_rate_limit_per_minute" BETWEEN 1 AND 6000);

-- CreateTable
CREATE TABLE "tenant_api_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "hash_version" INTEGER NOT NULL DEFAULT 1,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_user_id" TEXT,
    "revoked_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "rate_window_count" INTEGER NOT NULL DEFAULT 0,
    "rate_window_expires_at" TIMESTAMP(3),

    CONSTRAINT "tenant_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_api_keys_tenant_id_created_at_idx" ON "tenant_api_keys"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_action_logs_tenant_id_api_key_id_created_at_idx" ON "agent_action_logs"("tenant_id", "api_key_id", "created_at");

-- AddForeignKey
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_api_keys" ADD CONSTRAINT "tenant_api_keys_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
