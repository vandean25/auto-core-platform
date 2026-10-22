-- Expand-only schema M2 for legacy DMS migration documents (AUT-628)
-- Purge/clean-db may delete legacy rows only inside a transaction with:
--   SELECT set_config('acp.allow_purge', 'on', true);
-- (transaction-local; guards against app bugs, not a malicious DB user).

CREATE TYPE "CostBearer" AS ENUM ('CUSTOMER', 'WARRANTY', 'GOODWILL', 'INTERNAL');

CREATE TYPE "LegacyDocumentType" AS ENUM (
  'INVOICE',
  'CREDIT_MEMO',
  'SERVICE_ORDER',
  'QUOTE',
  'OPEN_ITEM',
  'WARRANTY_CLAIM',
  'SERVICE_CONTRACT',
  'TYRE_ORDER',
  'VEHICLE_HISTORY_SUMMARY'
);

CREATE TYPE "LegacyDocumentOrigin" AS ENUM ('SOURCE', 'PRIOR_SYSTEM');

CREATE TYPE "LegacyDocumentLineType" AS ENUM (
  'LABOR',
  'PART',
  'EXTERNAL_SERVICE',
  'FEE',
  'TEXT'
);

CREATE TYPE "MigrationRunStatus" AS ENUM (
  'DRAFT',
  'DRY_RUN_DONE',
  'SIGNED_OFF',
  'APPLIED',
  'FAILED'
);

CREATE TABLE "migration_runs" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "source_system" TEXT NOT NULL,
  "legal_entity_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "cutover_date" DATE NOT NULL,
  "status" "MigrationRunStatus" NOT NULL DEFAULT 'DRAFT',
  "manifest_json" JSONB NOT NULL,
  "manifest_sha256" CHAR(64) NOT NULL,
  "signed_off_by" TEXT,
  "signed_off_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "migration_runs_tenant_id_id_key" ON "migration_runs"("tenant_id", "id");
CREATE INDEX "migration_runs_tenant_id_idx" ON "migration_runs"("tenant_id");

ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_tenant_id_legal_entity_id_fkey"
  FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "import_jobs" ADD COLUMN "migration_run_id" UUID;

CREATE TABLE "legacy_documents" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "site_id" TEXT,
  "legal_entity_id" TEXT,
  "source_system" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "doc_type" "LegacyDocumentType" NOT NULL,
  "origin" "LegacyDocumentOrigin" NOT NULL,
  "doc_no" TEXT NOT NULL,
  "doc_date" DATE NOT NULL,
  "order_no" TEXT,
  "customer_id" TEXT,
  "bill_to_customer_id" TEXT,
  "vehicle_id" TEXT,
  "vin_snapshot" TEXT,
  "mileage" INTEGER,
  "currency" TEXT NOT NULL,
  "net_total" DECIMAL(10,2) NOT NULL,
  "vat_total" DECIMAL(10,2) NOT NULL,
  "gross_total" DECIMAL(10,2) NOT NULL,
  "remaining_amount" DECIMAL(10,2),
  "due_date" DATE,
  "payload_json" JSONB NOT NULL,
  "payload_sha256" CHAR(64) NOT NULL,
  "file_ref" TEXT,
  "file_sha256" CHAR(64),
  "retain_until" DATE NOT NULL,
  "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  "import_job_id" TEXT NOT NULL,
  "migration_run_id" UUID,
  "superseded_by_run_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legacy_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legacy_documents_tenant_id_id_key" ON "legacy_documents"("tenant_id", "id");
CREATE INDEX "legacy_documents_tenant_id_idx" ON "legacy_documents"("tenant_id");
CREATE INDEX "legacy_documents_tenant_id_source_system_doc_type_external__idx"
  ON "legacy_documents"("tenant_id", "source_system", "doc_type", "external_id");
CREATE INDEX "legacy_documents_tenant_id_migration_run_id_external_id_idx"
  ON "legacy_documents"("tenant_id", "migration_run_id", "external_id");

CREATE UNIQUE INDEX "legacy_documents_identity_non_open_item_key"
  ON "legacy_documents"("tenant_id", "source_system", "doc_type", "external_id")
  WHERE "doc_type" <> 'OPEN_ITEM';

CREATE UNIQUE INDEX "legacy_documents_open_item_per_run_key"
  ON "legacy_documents"("tenant_id", "migration_run_id", "external_id")
  WHERE "doc_type" = 'OPEN_ITEM';

ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_tenant_id_site_id_fkey"
  FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_tenant_id_legal_entity_id_fkey"
  FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_tenant_id_customer_id_fkey"
  FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_tenant_id_bill_to_customer_id_fkey"
  FOREIGN KEY ("tenant_id", "bill_to_customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_tenant_id_vehicle_id_fkey"
  FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_tenant_id_import_job_id_fkey"
  FOREIGN KEY ("tenant_id", "import_job_id") REFERENCES "import_jobs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_tenant_id_migration_run_id_fkey"
  FOREIGN KEY ("tenant_id", "migration_run_id") REFERENCES "migration_runs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_tenant_id_superseded_by_run_id_fkey"
  FOREIGN KEY ("tenant_id", "superseded_by_run_id") REFERENCES "migration_runs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_documents" ADD CONSTRAINT "legacy_documents_open_item_requires_migration_run_check"
  CHECK ("doc_type" <> 'OPEN_ITEM' OR "migration_run_id" IS NOT NULL);

CREATE TABLE "legacy_document_lines" (
  "tenant_id" TEXT NOT NULL,
  "legacy_document_id" UUID NOT NULL,
  "line_no" INTEGER NOT NULL,
  "line_type" "LegacyDocumentLineType" NOT NULL,
  "job_no" TEXT,
  "job_text" TEXT,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "unit_price" DECIMAL(10,2) NOT NULL,
  "net" DECIMAL(10,2) NOT NULL,
  "vat_rate" DECIMAL(5,2) NOT NULL,
  "vat_note" TEXT,
  "cost_bearer" "CostBearer",
  "payload_json" JSONB NOT NULL,
  CONSTRAINT "legacy_document_lines_pkey" PRIMARY KEY ("tenant_id", "legacy_document_id", "line_no")
);

CREATE INDEX "legacy_document_lines_tenant_id_idx" ON "legacy_document_lines"("tenant_id");

ALTER TABLE "legacy_document_lines" ADD CONSTRAINT "legacy_document_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_document_lines" ADD CONSTRAINT "legacy_document_lines_tenant_id_legacy_document_id_fkey"
  FOREIGN KEY ("tenant_id", "legacy_document_id") REFERENCES "legacy_documents"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_migration_run_id_fkey"
  FOREIGN KEY ("tenant_id", "migration_run_id") REFERENCES "migration_runs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_legacy_document_write_once()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('acp.allow_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'legacy documents are write-once (delete blocked)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."site_id" IS DISTINCT FROM OLD."site_id"
    OR NEW."legal_entity_id" IS DISTINCT FROM OLD."legal_entity_id"
    OR NEW."source_system" IS DISTINCT FROM OLD."source_system"
    OR NEW."external_id" IS DISTINCT FROM OLD."external_id"
    OR NEW."doc_type" IS DISTINCT FROM OLD."doc_type"
    OR NEW."origin" IS DISTINCT FROM OLD."origin"
    OR NEW."doc_no" IS DISTINCT FROM OLD."doc_no"
    OR NEW."doc_date" IS DISTINCT FROM OLD."doc_date"
    OR NEW."order_no" IS DISTINCT FROM OLD."order_no"
    OR NEW."customer_id" IS DISTINCT FROM OLD."customer_id"
    OR NEW."bill_to_customer_id" IS DISTINCT FROM OLD."bill_to_customer_id"
    OR NEW."vehicle_id" IS DISTINCT FROM OLD."vehicle_id"
    OR NEW."vin_snapshot" IS DISTINCT FROM OLD."vin_snapshot"
    OR NEW."mileage" IS DISTINCT FROM OLD."mileage"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."net_total" IS DISTINCT FROM OLD."net_total"
    OR NEW."vat_total" IS DISTINCT FROM OLD."vat_total"
    OR NEW."gross_total" IS DISTINCT FROM OLD."gross_total"
    OR NEW."remaining_amount" IS DISTINCT FROM OLD."remaining_amount"
    OR NEW."due_date" IS DISTINCT FROM OLD."due_date"
    OR NEW."payload_json" IS DISTINCT FROM OLD."payload_json"
    OR NEW."payload_sha256" IS DISTINCT FROM OLD."payload_sha256"
    OR NEW."file_ref" IS DISTINCT FROM OLD."file_ref"
    OR NEW."file_sha256" IS DISTINCT FROM OLD."file_sha256"
    OR NEW."retain_until" IS DISTINCT FROM OLD."retain_until"
    OR NEW."import_job_id" IS DISTINCT FROM OLD."import_job_id"
    OR NEW."migration_run_id" IS DISTINCT FROM OLD."migration_run_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'legacy documents are write-once (update blocked)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER legacy_documents_write_once
BEFORE UPDATE OR DELETE ON "legacy_documents"
FOR EACH ROW
EXECUTE FUNCTION prevent_legacy_document_write_once();

CREATE FUNCTION prevent_legacy_document_line_write_once()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('acp.allow_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'legacy document lines are write-once (delete blocked)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'legacy document lines are write-once (update blocked)'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER legacy_document_lines_write_once
BEFORE UPDATE OR DELETE ON "legacy_document_lines"
FOR EACH ROW
EXECUTE FUNCTION prevent_legacy_document_line_write_once();
