-- CreateEnum
CREATE TYPE "ImportEntityType" AS ENUM ('CUSTOMER', 'VEHICLE');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('DRY_RUN_DONE', 'APPLYING', 'APPLIED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('CREATE', 'UPDATE', 'SKIP', 'ERROR');

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" "ImportEntityType" NOT NULL,
    "source_system" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'DRY_RUN_DONE',
    "mapping_json" JSONB NOT NULL,
    "options_json" JSONB NOT NULL,
    "totals_json" JSONB NOT NULL,
    "created_by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_rows" (
    "tenant_id" TEXT NOT NULL,
    "import_job_id" TEXT NOT NULL,
    "row_no" INTEGER NOT NULL,
    "external_id" TEXT,
    "action" "ImportRowAction" NOT NULL,
    "entity_id" TEXT,
    "errors_json" JSONB,
    "warnings_json" JSONB,
    "normalized_json" JSONB,

    CONSTRAINT "import_job_rows_pkey" PRIMARY KEY ("tenant_id","import_job_id","row_no")
);

-- CreateTable
CREATE TABLE "external_id_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" "ImportEntityType" NOT NULL,
    "source_system" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "first_seen_import_job_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_id_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_tenant_id_createdAt_idx" ON "import_jobs"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_tenant_id_id_key" ON "import_jobs"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "import_job_rows_tenant_id_import_job_id_action_idx" ON "import_job_rows"("tenant_id", "import_job_id", "action");

-- CreateIndex
CREATE INDEX "external_id_mappings_tenant_id_entity_type_entity_id_idx" ON "external_id_mappings"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_id_mappings_tenant_id_entity_type_source_system_ext_key" ON "external_id_mappings"("tenant_id", "entity_type", "source_system", "external_id");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_tenant_id_import_job_id_fkey" FOREIGN KEY ("tenant_id", "import_job_id") REFERENCES "import_jobs"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_id_mappings" ADD CONSTRAINT "external_id_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_id_mappings" ADD CONSTRAINT "external_id_mappings_tenant_id_first_seen_import_job_id_fkey" FOREIGN KEY ("tenant_id", "first_seen_import_job_id") REFERENCES "import_jobs"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
