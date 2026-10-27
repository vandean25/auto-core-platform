-- Background import worker handoff and poison-job tracking (AUT-763, AUT-755).
ALTER TABLE "import_jobs"
ADD COLUMN "worker_handoff_at" TIMESTAMP(3),
ADD COLUMN "worker_claim_seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "worker_recovery_seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "attempts_without_progress" INTEGER NOT NULL DEFAULT 0;
