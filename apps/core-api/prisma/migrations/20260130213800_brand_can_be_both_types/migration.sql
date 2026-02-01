/*
  Warnings:

  - You are about to drop the column `type` on the `brands` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "brands" DROP COLUMN "type",
ADD COLUMN     "is_part_manufacturer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_vehicle_make" BOOLEAN NOT NULL DEFAULT false;

-- DropEnum
DROP TYPE "BrandType";
