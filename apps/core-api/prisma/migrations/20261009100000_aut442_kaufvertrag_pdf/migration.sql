-- AUT-442: Kaufvertrag PDF columns on vehicle sales (expand-only: all nullable, no backfill)
ALTER TABLE "vehicle_sales"
    ADD COLUMN "garantie_months" INTEGER,
    ADD COLUMN "garantie_terms" TEXT,
    ADD COLUMN "kaufvertrag_snapshot" JSONB,
    ADD COLUMN "kaufvertrag_snapshot_sha256" TEXT,
    ADD COLUMN "kaufvertrag_archive_bucket" TEXT,
    ADD COLUMN "kaufvertrag_archive_key" TEXT,
    ADD COLUMN "kaufvertrag_archive_generation" TEXT,
    ADD COLUMN "kaufvertrag_archive_sha256" TEXT,
    ADD COLUMN "kaufvertrag_generated_at" TIMESTAMP(3),
    ADD COLUMN "kaufvertrag_generation_error" TEXT;
