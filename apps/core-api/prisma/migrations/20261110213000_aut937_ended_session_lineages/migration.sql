-- ADR-0038 §3 ended session lineages (AUT-937).

CREATE TABLE "ended_session_lineages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "principal_sub" VARCHAR(128) NOT NULL,
    "continuity_digest" VARCHAR(64) NOT NULL,
    "auth_time_seconds" BIGINT NOT NULL,
    "site_id" TEXT,
    "ended_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refresh_tokens_revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "ended_session_lineages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ended_session_lineages_tenant_digest_key" ON "ended_session_lineages"("tenant_id", "continuity_digest");

CREATE INDEX "ended_session_lineages_tenant_id_principal_sub_idx" ON "ended_session_lineages"("tenant_id", "principal_sub");

ALTER TABLE "ended_session_lineages" ADD CONSTRAINT "ended_session_lineages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
