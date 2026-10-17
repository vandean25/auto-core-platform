-- AUT-556: immutable completion evidence and PDF archive digests

ALTER TABLE "workshop_check_ins"
ADD COLUMN "snapshot_json" JSONB,
ADD COLUMN "content_sha256" CHAR(64),
ADD COLUMN "completed_at" TIMESTAMP(3),
ADD COLUMN "completed_by_user_id" TEXT,
ADD COLUMN "pdf_storage_bucket" TEXT,
ADD COLUMN "pdf_storage_key" TEXT,
ADD COLUMN "pdf_sha256" CHAR(64),
ADD COLUMN "pdf_generated_at" TIMESTAMP(3);
