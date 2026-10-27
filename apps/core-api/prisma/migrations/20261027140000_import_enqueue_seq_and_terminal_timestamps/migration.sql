ALTER TABLE "import_jobs"
  ADD COLUMN "worker_enqueue_seq" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failed_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_at" TIMESTAMP(3);
