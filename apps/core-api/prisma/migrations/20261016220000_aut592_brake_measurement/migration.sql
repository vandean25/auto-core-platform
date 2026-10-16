-- AUT-592: §57a C3 brake test bench measurement import

CREATE TYPE "BrakeMeasurementSourceSystem" AS ENUM ('WORKSHOP_NET');
CREATE TYPE "InspectionMeasurementImportState" AS ENUM (
  'RECEIVED',
  'REJECTED',
  'QUARANTINED',
  'READY_FOR_REVIEW',
  'APPLIED'
);
CREATE TYPE "BrakeMeasurementFinality" AS ENUM ('FINAL', 'DRAFT', 'PARTIAL', 'UNKNOWN');

CREATE TABLE "inspection_device_sources" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "source_system" "BrakeMeasurementSourceSystem" NOT NULL,
    "source_instance_id" VARCHAR(128) NOT NULL,
    "device_serial" VARCHAR(128) NOT NULL,
    "device_model" VARCHAR(128) NOT NULL,
    "profile_id" VARCHAR(64) NOT NULL,
    "profile_version" VARCHAR(64) NOT NULL,
    "profile_digest" CHAR(64) NOT NULL,
    "binding_revision" INTEGER NOT NULL DEFAULT 1,
    "range_min" DECIMAL(12,3) NOT NULL,
    "range_max" DECIMAL(12,3) NOT NULL,
    "range_unit" VARCHAR(8) NOT NULL,
    "read_enabled" BOOLEAN NOT NULL DEFAULT false,
    "secret_ref" VARCHAR(256),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_device_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_device_evidence" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "device_source_id" TEXT NOT NULL,
    "evidence_ref" VARCHAR(128) NOT NULL,
    "evidence_revision" INTEGER NOT NULL DEFAULT 1,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until_exclusive" TIMESTAMP(3),
    "applicability_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_device_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_measurement_identities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_system" "BrakeMeasurementSourceSystem" NOT NULL,
    "source_instance_id" VARCHAR(128) NOT NULL,
    "measurement_id" VARCHAR(128) NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "workshop_order_id" TEXT NOT NULL,
    "device_source_id" TEXT NOT NULL,
    "session_ref" VARCHAR(128) NOT NULL,
    "semantic_digest" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_measurement_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_measurement_imports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "workshop_order_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "device_source_id" TEXT NOT NULL,
    "state" "InspectionMeasurementImportState" NOT NULL,
    "native_measurement_reference" VARCHAR(128) NOT NULL,
    "preview_fingerprint" CHAR(64),
    "semantic_digest" CHAR(64),
    "preview_expires_at" TIMESTAMP(3),
    "quarantine_reason" VARCHAR(64),
    "error_code" VARCHAR(64),
    "error_detail_redacted" VARCHAR(512),
    "version" INTEGER NOT NULL DEFAULT 0,
    "measurement_identity_id" TEXT,
    "applied_measurement_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_measurement_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_measurements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "workshop_order_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "device_source_id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "measurement_identity_id" TEXT NOT NULL,
    "source_system" "BrakeMeasurementSourceSystem" NOT NULL,
    "source_instance_id" VARCHAR(128) NOT NULL,
    "measurement_id" VARCHAR(128) NOT NULL,
    "revision" VARCHAR(128) NOT NULL,
    "session_ref" VARCHAR(128) NOT NULL,
    "vehicle_vin" VARCHAR(17) NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "finality" "BrakeMeasurementFinality" NOT NULL,
    "test_kind" VARCHAR(32) NOT NULL,
    "wheels_json" JSONB NOT NULL,
    "device_evidence_ref" VARCHAR(128),
    "native_result_ref" VARCHAR(128),
    "previous_measurement_ref" VARCHAR(128),
    "original_digest" CHAR(64) NOT NULL,
    "semantic_digest" CHAR(64) NOT NULL,
    "applied_by_user_id" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_measurements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inspection_device_sources_tenant_id_id_key" ON "inspection_device_sources"("tenant_id", "id");
CREATE UNIQUE INDEX "inspection_device_sources_tenant_id_site_id_source_system_sou_key" ON "inspection_device_sources"("tenant_id", "site_id", "source_system", "source_instance_id");
CREATE INDEX "inspection_device_sources_tenant_id_site_id_is_active_idx" ON "inspection_device_sources"("tenant_id", "site_id", "is_active");

CREATE UNIQUE INDEX "inspection_device_evidence_tenant_id_id_key" ON "inspection_device_evidence"("tenant_id", "id");
CREATE UNIQUE INDEX "inspection_device_evidence_tenant_id_device_source_id_evide_key" ON "inspection_device_evidence"("tenant_id", "device_source_id", "evidence_ref", "evidence_revision");
CREATE INDEX "inspection_device_evidence_tenant_id_site_id_idx" ON "inspection_device_evidence"("tenant_id", "site_id");

CREATE UNIQUE INDEX "inspection_measurement_identities_tenant_id_id_key" ON "inspection_measurement_identities"("tenant_id", "id");
CREATE UNIQUE INDEX "inspection_measurement_identities_tenant_id_source_system_sou_key" ON "inspection_measurement_identities"("tenant_id", "source_system", "source_instance_id", "measurement_id");

CREATE UNIQUE INDEX "inspection_measurement_imports_tenant_id_id_key" ON "inspection_measurement_imports"("tenant_id", "id");
CREATE INDEX "inspection_measurement_imports_tenant_id_workshop_order_id_cr_idx" ON "inspection_measurement_imports"("tenant_id", "workshop_order_id", "createdAt");
CREATE INDEX "inspection_measurement_imports_tenant_id_site_id_createdAt_idx" ON "inspection_measurement_imports"("tenant_id", "site_id", "createdAt");

CREATE UNIQUE INDEX "inspection_measurements_tenant_id_id_key" ON "inspection_measurements"("tenant_id", "id");
CREATE UNIQUE INDEX "inspection_measurements_tenant_id_import_id_key" ON "inspection_measurements"("tenant_id", "import_id");
CREATE INDEX "inspection_measurements_tenant_id_workshop_order_id_idx" ON "inspection_measurements"("tenant_id", "workshop_order_id");

ALTER TABLE "inspection_device_sources" ADD CONSTRAINT "inspection_device_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_device_sources" ADD CONSTRAINT "inspection_device_sources_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_device_evidence" ADD CONSTRAINT "inspection_device_evidence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_device_evidence" ADD CONSTRAINT "inspection_device_evidence_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_device_evidence" ADD CONSTRAINT "inspection_device_evidence_tenant_id_device_source_id_fkey" FOREIGN KEY ("tenant_id", "device_source_id") REFERENCES "inspection_device_sources"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_measurement_identities" ADD CONSTRAINT "inspection_measurement_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurement_identities" ADD CONSTRAINT "inspection_measurement_identities_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurement_identities" ADD CONSTRAINT "inspection_measurement_identities_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurement_identities" ADD CONSTRAINT "inspection_measurement_identities_tenant_id_device_source_id_fkey" FOREIGN KEY ("tenant_id", "device_source_id") REFERENCES "inspection_device_sources"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_measurement_imports" ADD CONSTRAINT "inspection_measurement_imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurement_imports" ADD CONSTRAINT "inspection_measurement_imports_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurement_imports" ADD CONSTRAINT "inspection_measurement_imports_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurement_imports" ADD CONSTRAINT "inspection_measurement_imports_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurement_imports" ADD CONSTRAINT "inspection_measurement_imports_tenant_id_device_source_id_fkey" FOREIGN KEY ("tenant_id", "device_source_id") REFERENCES "inspection_device_sources"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurement_imports" ADD CONSTRAINT "inspection_measurement_imports_tenant_id_measurement_identity__fkey" FOREIGN KEY ("tenant_id", "measurement_identity_id") REFERENCES "inspection_measurement_identities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_measurements" ADD CONSTRAINT "inspection_measurements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurements" ADD CONSTRAINT "inspection_measurements_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurements" ADD CONSTRAINT "inspection_measurements_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurements" ADD CONSTRAINT "inspection_measurements_tenant_id_vehicle_id_fkey" FOREIGN KEY ("tenant_id", "vehicle_id") REFERENCES "vehicles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurements" ADD CONSTRAINT "inspection_measurements_tenant_id_device_source_id_fkey" FOREIGN KEY ("tenant_id", "device_source_id") REFERENCES "inspection_device_sources"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurements" ADD CONSTRAINT "inspection_measurements_tenant_id_import_id_fkey" FOREIGN KEY ("tenant_id", "import_id") REFERENCES "inspection_measurement_imports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_measurements" ADD CONSTRAINT "inspection_measurements_tenant_id_measurement_identity_id_fkey" FOREIGN KEY ("tenant_id", "measurement_identity_id") REFERENCES "inspection_measurement_identities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
