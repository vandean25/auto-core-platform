-- AUT-839: persist scheduled job execution timestamps and distributed lease claims
CREATE TABLE IF NOT EXISTS "scheduled_job_runs" (
    "job_name" VARCHAR(128) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "run_id" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("job_name")
);

-- Seed/upsert initial row for import-job-row-purge so it exists on boot
INSERT INTO "scheduled_job_runs" ("job_name", "created_at", "updated_at")
VALUES ('import-job-row-purge', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("job_name") DO NOTHING;
