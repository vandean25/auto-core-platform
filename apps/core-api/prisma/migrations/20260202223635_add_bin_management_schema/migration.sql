/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `storage_locations` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `code` to the `storage_locations` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "LocationType" ADD VALUE 'aisle';

-- AlterTable
ALTER TABLE "storage_locations" ADD COLUMN "code" TEXT;

-- Update existing rows with a default code based on ID or Name
-- Since we expect only a few rows in dev, generating a unique code is key.
UPDATE "storage_locations" SET "code" = 'LOC-' || substr(md5(random()::text), 1, 6) WHERE "code" IS NULL;

-- AlterTable
ALTER TABLE "storage_locations" ALTER COLUMN "code" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_code_key" ON "storage_locations"("code");