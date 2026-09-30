-- AlterTable
ALTER TABLE "document_brand_assets" ADD COLUMN "preview_bucket" TEXT,
ADD COLUMN "preview_object_key" TEXT,
ADD COLUMN "preview_object_generation" TEXT;
