-- CreateEnum
CREATE TYPE "DocumentBrandAssetPurpose" AS ENUM ('SOURCE', 'LOGO');

-- CreateEnum
CREATE TYPE "DocumentBrandAssetState" AS ENUM ('QUARANTINED', 'READY', 'REJECTED', 'DELETING', 'DELETED');

-- CreateTable
CREATE TABLE "document_brand_assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "source_asset_id" TEXT,
    "purpose" "DocumentBrandAssetPurpose" NOT NULL,
    "state" "DocumentBrandAssetState" NOT NULL DEFAULT 'QUARANTINED',
    "bucket" TEXT,
    "object_key" TEXT,
    "object_generation" TEXT,
    "sha256" TEXT,
    "byte_length" INTEGER NOT NULL,
    "detected_mime_type" TEXT,
    "pixel_width" INTEGER,
    "pixel_height" INTEGER,
    "original_filename" VARCHAR(255),
    "quarantine_bucket" TEXT,
    "quarantine_object_key" TEXT,
    "quarantine_object_generation" TEXT,
    "validation_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "validation_dispatched_at" TIMESTAMP(3),
    "validation_lease_until" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_brand_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_brand_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "active_revision" INTEGER NOT NULL DEFAULT 0,
    "active_theme" JSONB,
    "draft_theme" JSONB,
    "active_logo_asset_id" TEXT,
    "draft_logo_asset_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_user_id" TEXT,
    "last_confirmation_key" TEXT,
    "last_confirmation_hash" TEXT,
    "last_confirmation_result_revision" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_brand_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_brand_assets_tenant_id_legal_entity_id_state_expir_idx" ON "document_brand_assets"("tenant_id", "legal_entity_id", "state", "expires_at");

-- CreateIndex
CREATE INDEX "document_brand_assets_tenant_id_legal_entity_id_source_asse_idx" ON "document_brand_assets"("tenant_id", "legal_entity_id", "source_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_brand_assets_tenant_id_id_key" ON "document_brand_assets"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_brand_assets_tenant_id_legal_entity_id_id_key" ON "document_brand_assets"("tenant_id", "legal_entity_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_brand_assets_tenant_id_bucket_object_key_object_ge_key" ON "document_brand_assets"("tenant_id", "bucket", "object_key", "object_generation");

-- CreateIndex
CREATE INDEX "document_brand_profiles_tenant_id_idx" ON "document_brand_profiles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_brand_profiles_tenant_id_id_key" ON "document_brand_profiles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_brand_profiles_tenant_id_legal_entity_id_key" ON "document_brand_profiles"("tenant_id", "legal_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_brand_profiles_tenant_id_legal_entity_id_id_key" ON "document_brand_profiles"("tenant_id", "legal_entity_id", "id");

-- AddForeignKey
ALTER TABLE "document_brand_assets" ADD CONSTRAINT "document_brand_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_brand_assets" ADD CONSTRAINT "document_brand_assets_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_brand_assets" ADD CONSTRAINT "document_brand_assets_tenant_id_legal_entity_id_source_ass_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id", "source_asset_id") REFERENCES "document_brand_assets"("tenant_id", "legal_entity_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_brand_profiles" ADD CONSTRAINT "document_brand_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_brand_profiles" ADD CONSTRAINT "document_brand_profiles_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_brand_profiles" ADD CONSTRAINT "document_brand_profiles_tenant_id_legal_entity_id_active_l_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id", "active_logo_asset_id") REFERENCES "document_brand_assets"("tenant_id", "legal_entity_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_brand_profiles" ADD CONSTRAINT "document_brand_profiles_tenant_id_legal_entity_id_draft_lo_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id", "draft_logo_asset_id") REFERENCES "document_brand_assets"("tenant_id", "legal_entity_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_brand_profiles" ADD CONSTRAINT "document_brand_profiles_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_brand_assets"
ADD CONSTRAINT "document_brand_assets_ready_identity_check"
CHECK (
    "state" <> 'READY'
    OR (
        "bucket" IS NOT NULL
        AND "object_key" IS NOT NULL
        AND "object_generation" IS NOT NULL
        AND "sha256" ~ '^[a-f0-9]{64}$'
        AND "byte_length" > 0
        AND "detected_mime_type" IN ('image/png', 'application/pdf')
        AND ("pixel_width" IS NULL OR "pixel_width" BETWEEN 1 AND 8192)
        AND ("pixel_height" IS NULL OR "pixel_height" BETWEEN 1 AND 8192)
    )
);

CREATE FUNCTION prevent_ready_document_brand_asset_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."state" IN ('READY', 'DELETING', 'DELETED') AND (
        NEW."bucket" IS DISTINCT FROM OLD."bucket"
        OR NEW."object_key" IS DISTINCT FROM OLD."object_key"
        OR NEW."object_generation" IS DISTINCT FROM OLD."object_generation"
        OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
        OR NEW."byte_length" IS DISTINCT FROM OLD."byte_length"
        OR NEW."detected_mime_type" IS DISTINCT FROM OLD."detected_mime_type"
        OR NEW."pixel_width" IS DISTINCT FROM OLD."pixel_width"
        OR NEW."pixel_height" IS DISTINCT FROM OLD."pixel_height"
    ) THEN
        RAISE EXCEPTION 'Ready document branding asset identity is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER document_brand_assets_immutable_ready_identity
BEFORE UPDATE ON "document_brand_assets"
FOR EACH ROW
EXECUTE FUNCTION prevent_ready_document_brand_asset_identity_change();

CREATE TYPE "DocumentBrandQuotaAction" AS ENUM ('ASSET_UPLOAD', 'PREVIEW');

CREATE TABLE "document_brand_quota_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT,
    "user_id" TEXT,
    "action" "DocumentBrandQuotaAction" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_brand_quota_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_brand_quota_events_tenant_id_legal_entity_id_action_created_at_idx"
ON "document_brand_quota_events"("tenant_id", "legal_entity_id", "action", "created_at");

CREATE INDEX "document_brand_quota_events_tenant_id_user_id_action_created_at_idx"
ON "document_brand_quota_events"("tenant_id", "user_id", "action", "created_at");

ALTER TABLE "document_brand_quota_events"
ADD CONSTRAINT "document_brand_quota_events_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "document_brand_quota_locks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "action" "DocumentBrandQuotaAction" NOT NULL,
    "scope_key" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "document_brand_quota_locks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_brand_quota_locks_tenant_id_action_scope_key_key"
ON "document_brand_quota_locks"("tenant_id", "action", "scope_key");

ALTER TABLE "document_brand_quota_locks"
ADD CONSTRAINT "document_brand_quota_locks_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
