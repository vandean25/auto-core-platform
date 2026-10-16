-- AUT-533: §57a external inspection result import (inbound EBV slice)

CREATE TYPE "InspectionSourceSystem" AS ENUM ('EBV');
CREATE TYPE "InspectionExchangeImportState" AS ENUM ('RECEIVED', 'REJECTED', 'UNCONFIRMED', 'READY_FOR_REVIEW', 'APPLIED', 'CONFLICT');
CREATE TYPE "ExternalInspectionOutcome" AS ENUM ('POSITIVE', 'NEGATIVE', 'REVOKED', 'UNKNOWN');
CREATE TYPE "ExternalInspectionFinality" AS ENUM ('FINAL', 'DRAFT', 'UNKNOWN');
CREATE TYPE "ExternalInspectionAckState" AS ENUM ('CONFIRMED', 'UNCONFIRMED', 'UNKNOWN');
CREATE TYPE "InspectionOccurrenceKind" AS ENUM ('INITIAL', 'CORRECTION', 'REVOCATION', 'UNKNOWN');

ALTER TYPE "VehicleInspectionRecordSource" ADD VALUE 'EBV_IMPORTED';

CREATE TABLE "inspection_source_connections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "source_system" "InspectionSourceSystem" NOT NULL,
    "source_account_ref" VARCHAR(128) NOT NULL,
    "source_station_id" VARCHAR(128) NOT NULL,
    "profile_id" VARCHAR(64) NOT NULL,
    "profile_version" VARCHAR(64) NOT NULL,
    "profile_digest" CHAR(64) NOT NULL,
    "binding_revision" INTEGER NOT NULL DEFAULT 1,
    "read_enabled" BOOLEAN NOT NULL DEFAULT false,
    "secret_ref" VARCHAR(256),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_source_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_report_identities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "zbd_report_id" VARCHAR(128) NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_report_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_exchange_imports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "workshop_order_id" TEXT,
    "state" "InspectionExchangeImportState" NOT NULL,
    "native_result_reference" VARCHAR(128) NOT NULL,
    "preview_fingerprint" CHAR(64),
    "semantic_digest" CHAR(64),
    "preview_expires_at" TIMESTAMP(3),
    "error_code" VARCHAR(64),
    "error_detail_redacted" VARCHAR(512),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT NOT NULL,
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "applied_external_result_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_exchange_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_inspection_results" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "report_identity_id" TEXT,
    "source_system" "InspectionSourceSystem" NOT NULL,
    "source_account_ref" VARCHAR(128) NOT NULL,
    "source_station_id" VARCHAR(128) NOT NULL,
    "source_result_id" VARCHAR(128) NOT NULL,
    "source_revision" VARCHAR(128) NOT NULL,
    "source_schema_version" VARCHAR(64) NOT NULL,
    "zbd_report_id" VARCHAR(128),
    "occurrence_kind" "InspectionOccurrenceKind" NOT NULL,
    "occurrence_predecessor" JSONB,
    "classification_evidence_ref" VARCHAR(128),
    "vehicle_vin" VARCHAR(17) NOT NULL,
    "vehicle_first_registration_on" DATE NOT NULL,
    "vehicle_registration_plate" VARCHAR(32),
    "inspected_at" TIMESTAMP(3) NOT NULL,
    "inspected_on" DATE NOT NULL,
    "inspector_source_person_id" VARCHAR(128) NOT NULL,
    "qualification_evidence_ref" VARCHAR(128),
    "outcome" "ExternalInspectionOutcome" NOT NULL,
    "native_outcome_code" VARCHAR(128),
    "plate_number" VARCHAR(32),
    "plate_colour" VARCHAR(32),
    "plate_valid_until_year" INTEGER,
    "plate_valid_until_month" INTEGER,
    "odometer_value" DECIMAL(12,3),
    "odometer_unit" VARCHAR(8),
    "finality" "ExternalInspectionFinality" NOT NULL,
    "acknowledgement_state" "ExternalInspectionAckState" NOT NULL,
    "acknowledgement_evidence_type" VARCHAR(64),
    "acknowledgement_evidence_ref" VARCHAR(128),
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "original_digest" CHAR(64) NOT NULL,
    "semantic_digest" CHAR(64) NOT NULL,
    "applied_by_user_id" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_inspection_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_exchange_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "external_result_id" TEXT,
    "previous_state" "InspectionExchangeImportState",
    "new_state" "InspectionExchangeImportState" NOT NULL,
    "reason" VARCHAR(128),
    "actor_user_id" TEXT,
    "semantic_digest" CHAR(64),
    "conflicting_digest" CHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_exchange_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "vehicle_inspection_records" ADD COLUMN "external_inspection_result_id" TEXT;

CREATE UNIQUE INDEX "vehicle_inspection_records_tenant_id_external_inspection_res_key" ON "vehicle_inspection_records"("tenant_id", "external_inspection_result_id");

CREATE UNIQUE INDEX "inspection_source_connections_tenant_id_id_key" ON "inspection_source_connections"("tenant_id", "id");
CREATE UNIQUE INDEX "inspection_source_connections_tenant_id_site_id_source_system_key" ON "inspection_source_connections"("tenant_id", "site_id", "source_system", "source_account_ref");
CREATE INDEX "inspection_source_connections_tenant_id_site_id_is_active_idx" ON "inspection_source_connections"("tenant_id", "site_id", "is_active");

CREATE UNIQUE INDEX "inspection_report_identities_tenant_id_zbd_report_id_key" ON "inspection_report_identities"("tenant_id", "zbd_report_id");
CREATE UNIQUE INDEX "inspection_report_identities_tenant_id_id_vehicle_id_key" ON "inspection_report_identities"("tenant_id", "id", "vehicle_id");

CREATE UNIQUE INDEX "inspection_exchange_imports_tenant_id_id_key" ON "inspection_exchange_imports"("tenant_id", "id");
CREATE INDEX "inspection_exchange_imports_tenant_id_site_id_vehicle_id_cre_idx" ON "inspection_exchange_imports"("tenant_id", "site_id", "vehicle_id", "createdAt");
CREATE INDEX "inspection_exchange_imports_tenant_id_vehicle_id_idx" ON "inspection_exchange_imports"("tenant_id", "vehicle_id");

CREATE UNIQUE INDEX "external_inspection_results_tenant_id_id_key" ON "external_inspection_results"("tenant_id", "id");
CREATE UNIQUE INDEX "external_inspection_results_tenant_id_import_id_key" ON "external_inspection_results"("tenant_id", "import_id");
CREATE UNIQUE INDEX "external_inspection_results_replay_key" ON "external_inspection_results"("tenant_id", "source_system", "source_account_ref", "source_station_id", "source_result_id", "source_revision");
CREATE INDEX "external_inspection_results_tenant_id_vehicle_id_idx" ON "external_inspection_results"("tenant_id", "vehicle_id");

CREATE INDEX "inspection_exchange_events_tenant_id_import_id_created_at_idx" ON "inspection_exchange_events"("tenant_id", "import_id", "created_at");

ALTER TABLE "inspection_source_connections" ADD CONSTRAINT "inspection_source_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_source_connections" ADD CONSTRAINT "inspection_source_connections_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_source_connections" ADD CONSTRAINT "inspection_source_connections_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_report_identities" ADD CONSTRAINT "inspection_report_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_report_identities" ADD CONSTRAINT "inspection_report_identities_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_exchange_imports" ADD CONSTRAINT "inspection_exchange_imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_exchange_imports" ADD CONSTRAINT "inspection_exchange_imports_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_exchange_imports" ADD CONSTRAINT "inspection_exchange_imports_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_exchange_imports" ADD CONSTRAINT "inspection_exchange_imports_tenant_id_connection_id_fkey" FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "inspection_source_connections"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "external_inspection_results" ADD CONSTRAINT "external_inspection_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_inspection_results" ADD CONSTRAINT "external_inspection_results_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_inspection_results" ADD CONSTRAINT "external_inspection_results_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_inspection_results" ADD CONSTRAINT "external_inspection_results_tenant_id_connection_id_fkey" FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "inspection_source_connections"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_inspection_results" ADD CONSTRAINT "external_inspection_results_tenant_id_import_id_fkey" FOREIGN KEY ("tenant_id", "import_id") REFERENCES "inspection_exchange_imports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_inspection_results" ADD CONSTRAINT "external_inspection_results_report_identity_fkey" FOREIGN KEY ("tenant_id", "report_identity_id", "vehicle_id") REFERENCES "inspection_report_identities"("tenant_id", "id", "vehicle_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_exchange_events" ADD CONSTRAINT "inspection_exchange_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_exchange_events" ADD CONSTRAINT "inspection_exchange_events_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_exchange_events" ADD CONSTRAINT "inspection_exchange_events_tenant_id_import_id_fkey" FOREIGN KEY ("tenant_id", "import_id") REFERENCES "inspection_exchange_imports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_inspection_records" ADD CONSTRAINT "vehicle_inspection_records_external_result_fkey" FOREIGN KEY ("tenant_id", "external_inspection_result_id") REFERENCES "external_inspection_results"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
