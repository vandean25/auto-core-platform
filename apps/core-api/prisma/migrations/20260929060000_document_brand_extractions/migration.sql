ALTER TYPE "DocumentBrandQuotaAction" ADD VALUE 'EXTRACTION';

CREATE TYPE "DocumentBrandExtractionState" AS ENUM (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'DISCARDED'
);

CREATE TABLE "document_brand_extractions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "legal_entity_id" TEXT NOT NULL,
  "source_asset_id" TEXT,
  "proposal_logo_asset_id" TEXT,
  "requested_by_user_id" TEXT,
  "base_revision" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "state" "DocumentBrandExtractionState" NOT NULL DEFAULT 'QUEUED',
  "proposal" JSONB,
  "warning_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "failure_code" VARCHAR(64),
  "provider_id" VARCHAR(64),
  "model_id" VARCHAR(128),
  "prompt_version" VARCHAR(64),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "dispatch_count" INTEGER NOT NULL DEFAULT 0,
  "lease_token" VARCHAR(64),
  "lease_until" TIMESTAMP(3),
  "dispatched_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "document_brand_extractions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_brand_extractions_attempt_count_check"
    CHECK ("attempt_count" >= 0 AND "attempt_count" <= 3),
  CONSTRAINT "document_brand_extractions_dispatch_count_check"
    CHECK ("dispatch_count" >= 0),
  CONSTRAINT "document_brand_extractions_request_hash_check"
    CHECK ("request_hash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "document_brand_extractions_tenant_id_id_key"
  ON "document_brand_extractions"("tenant_id", "id");

CREATE UNIQUE INDEX "document_brand_extractions_tenant_entity_id_key"
  ON "document_brand_extractions"("tenant_id", "legal_entity_id", "id");

CREATE UNIQUE INDEX "document_brand_extractions_idempotency_key"
  ON "document_brand_extractions"("tenant_id", "legal_entity_id", "idempotency_key");

CREATE INDEX "document_brand_extractions_state_created_idx"
  ON "document_brand_extractions"("tenant_id", "legal_entity_id", "state", "createdAt");

CREATE INDEX "document_brand_extractions_recovery_idx"
  ON "document_brand_extractions"("tenant_id", "state", "lease_until");

CREATE INDEX "document_brand_extractions_expiry_idx"
  ON "document_brand_extractions"("expires_at");

CREATE UNIQUE INDEX "document_brand_extractions_one_active_per_entity"
  ON "document_brand_extractions"("tenant_id", "legal_entity_id")
  WHERE "state" IN ('QUEUED', 'RUNNING');

ALTER TABLE "document_brand_extractions"
  ADD CONSTRAINT "document_brand_extractions_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_brand_extractions"
  ADD CONSTRAINT "document_brand_extractions_entity_fkey"
  FOREIGN KEY ("tenant_id", "legal_entity_id")
  REFERENCES "legal_entities"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_brand_extractions"
  ADD CONSTRAINT "document_brand_extractions_source_asset_fkey"
  FOREIGN KEY ("tenant_id", "legal_entity_id", "source_asset_id")
  REFERENCES "document_brand_assets"("tenant_id", "legal_entity_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_brand_extractions"
  ADD CONSTRAINT "document_brand_extractions_proposal_logo_asset_fkey"
  FOREIGN KEY ("tenant_id", "legal_entity_id", "proposal_logo_asset_id")
  REFERENCES "document_brand_assets"("tenant_id", "legal_entity_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_brand_extractions"
  ADD CONSTRAINT "document_brand_extractions_requested_by_user_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_brand_profiles"
  ADD COLUMN "draft_extraction_id" TEXT;

ALTER TABLE "document_brand_profiles"
  ADD CONSTRAINT "document_brand_profiles_draft_extraction_fkey"
  FOREIGN KEY ("tenant_id", "legal_entity_id", "draft_extraction_id")
  REFERENCES "document_brand_extractions"("tenant_id", "legal_entity_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
