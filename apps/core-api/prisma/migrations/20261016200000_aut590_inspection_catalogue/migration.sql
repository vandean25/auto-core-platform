-- AUT-590: §57a C1 versioned inspection catalogue reference contract

CREATE TYPE "InspectionCatalogueSourceKind" AS ENUM ('STATUTORY_REFERENCE', 'APPROVED_CATALOGUE', 'TEST_ONLY');
CREATE TYPE "InspectionCatalogueCoverage" AS ENUM ('SUBSET', 'COMPLETE');
CREATE TYPE "InspectionCatalogueImportState" AS ENUM ('RECEIVED', 'REJECTED', 'READY_FOR_ACTIVATION', 'ACTIVATED', 'CONFLICT');
CREATE TYPE "InspectionReferenceResolutionStatus" AS ENUM ('RESOLVED', 'UNKNOWN_CODE', 'STALE_CATALOG', 'OUT_OF_SCOPE', 'NOT_CONFIGURED', 'SOURCE_CONFLICT');
CREATE TYPE "InspectionSupportContractKind" AS ENUM ('INSPECTION_CATALOGUE', 'INSPECTOR_EVIDENCE', 'BRAKE_MEASUREMENT', 'EXTERNAL_RESULT');

CREATE TABLE "inspection_catalogue_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "schema_version" VARCHAR(32) NOT NULL,
    "source_kind" "InspectionCatalogueSourceKind" NOT NULL,
    "publisher" TEXT NOT NULL,
    "source_uri" TEXT NOT NULL,
    "source_document_id" VARCHAR(256) NOT NULL,
    "source_version" VARCHAR(128) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "verified_current_at" TIMESTAMP(3) NOT NULL,
    "recheck_after" TIMESTAMP(3) NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "coverage" "InspectionCatalogueCoverage" NOT NULL,
    "rights" VARCHAR(128) NOT NULL,
    "approval_evidence_ref" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_catalogue_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_catalogue_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "catalogue_version_id" TEXT NOT NULL,
    "position_id" VARCHAR(64) NOT NULL,
    "entry_id" VARCHAR(64),
    "entry_locator" VARCHAR(192) NOT NULL,
    "label" TEXT NOT NULL,
    "allowed_groups" JSONB NOT NULL,
    "vehicle_scope" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_catalogue_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_inspection_catalogue_activations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT,
    "catalogue_version_id" TEXT NOT NULL,
    "source_kind" "InspectionCatalogueSourceKind" NOT NULL,
    "activated_at" TIMESTAMP(3) NOT NULL,
    "activated_by_user_id" TEXT NOT NULL,
    "deactivated_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_inspection_catalogue_activations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_catalogue_imports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "state" "InspectionCatalogueImportState" NOT NULL,
    "manifest_reference" VARCHAR(128) NOT NULL,
    "preview_fingerprint" CHAR(64),
    "manifest_digest" CHAR(64),
    "preview_expires_at" TIMESTAMP(3),
    "error_code" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 0,
    "staged_version_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "activated_by_user_id" TEXT,
    "activated_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_catalogue_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_finding_references" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "workshop_inspection_id" TEXT NOT NULL,
    "catalogue_version_id" TEXT NOT NULL,
    "position_id" VARCHAR(64) NOT NULL,
    "entry_id" VARCHAR(64),
    "label_snapshot" TEXT NOT NULL,
    "allowed_groups_snapshot" JSONB NOT NULL,
    "provenance_snapshot" JSONB NOT NULL,
    "human_finding_label" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_finding_references_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_support_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT,
    "contract_kind" "InspectionSupportContractKind" NOT NULL,
    "object_id" VARCHAR(64) NOT NULL,
    "source_digest" CHAR(64),
    "reason" VARCHAR(128),
    "actor_user_id" TEXT,
    "detail_redacted" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_support_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inspection_catalogue_versions_tenant_id_id_key" ON "inspection_catalogue_versions"("tenant_id", "id");
CREATE UNIQUE INDEX "inspection_catalogue_versions_tenant_id_source_kind_source_vers_key" ON "inspection_catalogue_versions"("tenant_id", "source_kind", "source_version", "content_sha256");
CREATE INDEX "inspection_catalogue_versions_tenant_id_source_kind_valid_from_idx" ON "inspection_catalogue_versions"("tenant_id", "source_kind", "valid_from");

CREATE UNIQUE INDEX "inspection_catalogue_entries_tenant_id_id_key" ON "inspection_catalogue_entries"("tenant_id", "id");
CREATE UNIQUE INDEX "inspection_catalogue_entries_tenant_id_catalogue_version_id_en_key" ON "inspection_catalogue_entries"("tenant_id", "catalogue_version_id", "entry_locator");
CREATE INDEX "inspection_catalogue_entries_tenant_id_catalogue_version_id_po_idx" ON "inspection_catalogue_entries"("tenant_id", "catalogue_version_id", "position_id");

CREATE UNIQUE INDEX "tenant_inspection_catalogue_activations_tenant_id_id_key" ON "tenant_inspection_catalogue_activations"("tenant_id", "id");
CREATE INDEX "tenant_inspection_catalogue_activations_tenant_id_site_id_sour_idx" ON "tenant_inspection_catalogue_activations"("tenant_id", "site_id", "source_kind", "deactivated_at");

CREATE UNIQUE INDEX "inspection_catalogue_imports_tenant_id_id_key" ON "inspection_catalogue_imports"("tenant_id", "id");
CREATE INDEX "inspection_catalogue_imports_tenant_id_site_id_createdAt_idx" ON "inspection_catalogue_imports"("tenant_id", "site_id", "createdAt");

CREATE UNIQUE INDEX "inspection_finding_references_tenant_id_id_key" ON "inspection_finding_references"("tenant_id", "id");
CREATE INDEX "inspection_finding_references_tenant_id_workshop_inspection__idx" ON "inspection_finding_references"("tenant_id", "workshop_inspection_id");

CREATE INDEX "inspection_support_events_tenant_id_contract_kind_object_id_c_idx" ON "inspection_support_events"("tenant_id", "contract_kind", "object_id", "created_at");

ALTER TABLE "inspection_catalogue_versions" ADD CONSTRAINT "inspection_catalogue_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_catalogue_entries" ADD CONSTRAINT "inspection_catalogue_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_catalogue_entries" ADD CONSTRAINT "inspection_catalogue_entries_tenant_id_catalogue_version_id_fkey" FOREIGN KEY ("tenant_id", "catalogue_version_id") REFERENCES "inspection_catalogue_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_inspection_catalogue_activations" ADD CONSTRAINT "tenant_inspection_catalogue_activations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_inspection_catalogue_activations" ADD CONSTRAINT "tenant_inspection_catalogue_activations_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_inspection_catalogue_activations" ADD CONSTRAINT "tenant_inspection_catalogue_activations_tenant_id_catalogue_ve_fkey" FOREIGN KEY ("tenant_id", "catalogue_version_id") REFERENCES "inspection_catalogue_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_catalogue_imports" ADD CONSTRAINT "inspection_catalogue_imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_catalogue_imports" ADD CONSTRAINT "inspection_catalogue_imports_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_catalogue_imports" ADD CONSTRAINT "inspection_catalogue_imports_tenant_id_staged_version_id_fkey" FOREIGN KEY ("tenant_id", "staged_version_id") REFERENCES "inspection_catalogue_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_finding_references" ADD CONSTRAINT "inspection_finding_references_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_finding_references" ADD CONSTRAINT "inspection_finding_references_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_finding_references" ADD CONSTRAINT "inspection_finding_references_tenant_id_workshop_inspection__fkey" FOREIGN KEY ("tenant_id", "workshop_inspection_id") REFERENCES "workshop_inspections"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_finding_references" ADD CONSTRAINT "inspection_finding_references_tenant_id_catalogue_version_id_fkey" FOREIGN KEY ("tenant_id", "catalogue_version_id") REFERENCES "inspection_catalogue_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_support_events" ADD CONSTRAINT "inspection_support_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_support_events" ADD CONSTRAINT "inspection_support_events_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
