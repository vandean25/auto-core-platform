-- AUT-813: undo a completed import batch (terminal statuses UNDONE and PARTIALLY_UNDONE, per-row before snapshot)
ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'UNDONE';
ALTER TYPE "ImportJobStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_UNDONE';

ALTER TABLE "import_job_rows"
    ADD COLUMN IF NOT EXISTS "before_snapshot_json" JSONB;
