ALTER TABLE "import_jobs" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "import_jobs" SET "updated_at" = "createdAt";
ALTER TABLE "import_jobs" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "import_jobs" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
