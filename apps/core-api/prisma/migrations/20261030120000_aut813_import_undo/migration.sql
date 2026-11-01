-- AUT-813: undo a completed import batch (terminal statuses UNDONE and PARTIALLY_UNDONE, per-row before snapshot)
ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'UNDONE';
ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_UNDONE';
ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'UNDOING';

ALTER TABLE "import_job_rows"
    ADD COLUMN IF NOT EXISTS "before_snapshot_json" JSONB;

ALTER TABLE "import_job_rows"
    ADD COLUMN IF NOT EXISTS "undone_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "import_job_rows_tenant_id_import_job_id_undone_at_idx"
    ON "import_job_rows"("tenant_id", "import_job_id", "undone_at");
