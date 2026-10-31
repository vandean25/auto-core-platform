-- AUT-809: tenant-level import sources (normalized slug key, display label, default flag)
-- Schema: new table import_sources, unique per (tenant_id, key).
-- "key" is unbounded because the backfill copies every historical source_system verbatim,
-- including names longer than the 64-character limit that applies to newly created keys.

CREATE TABLE "import_sources" (
    "id"        TEXT         NOT NULL,
    "tenant_id" TEXT         NOT NULL,
    "key"       TEXT         NOT NULL,
    "label"     TEXT         NOT NULL,
    "is_default" BOOLEAN     NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "import_sources_tenant_id_key_key"
    ON "import_sources"("tenant_id", "key");

CREATE INDEX "import_sources_tenant_id_idx"
    ON "import_sources"("tenant_id");

-- At most one default source per tenant.
CREATE UNIQUE INDEX "import_sources_one_default_per_tenant"
    ON "import_sources"("tenant_id")
    WHERE "is_default";

ALTER TABLE "import_sources"
    ADD CONSTRAINT "import_sources_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data migration: one import_source per distinct source_system already used
-- in import_jobs, external_id_mappings and import_mapping_profiles.
-- Keys are byte-identical (no renaming). Idempotent (ON CONFLICT DO NOTHING).
-- The first source per tenant (by earliest import_job createdAt, or arbitrary
-- for tenants with only mappings/profiles) is marked is_default = true.

INSERT INTO "import_sources" ("id", "tenant_id", "key", "label", "is_default", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    distinct_sources.tenant_id,
    distinct_sources.source_system,
    distinct_sources.source_system,
    row_number() OVER (
        PARTITION BY distinct_sources.tenant_id
        ORDER BY distinct_sources.first_seen ASC
    ) = 1,
    now(),
    now()
FROM (
    SELECT
        tenant_id,
        source_system,
        min(first_seen) AS first_seen
    FROM (
        SELECT tenant_id, source_system, "createdAt" AS first_seen
        FROM "import_jobs"
        UNION ALL
        SELECT tenant_id, source_system, "createdAt"
        FROM "external_id_mappings"
        UNION ALL
        SELECT tenant_id, source_system, "createdAt"
        FROM "import_mapping_profiles"
    ) all_sources
    GROUP BY tenant_id, source_system
) distinct_sources
ON CONFLICT ("tenant_id", "key") DO NOTHING;
