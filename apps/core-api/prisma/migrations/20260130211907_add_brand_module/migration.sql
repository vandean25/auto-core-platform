/*
  Warnings:

  - You are about to drop the column `brand` on the `catalog_items` table. All the data in the column will be lost.
  - You are about to drop the column `supported_brands` on the `vendors` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "BrandType" AS ENUM ('VEHICLE_MAKE', 'PART_MANUFACTURER');

-- AlterTable
ALTER TABLE "catalog_items" DROP COLUMN "brand",
ADD COLUMN     "brand_id" INTEGER;

-- AlterTable
ALTER TABLE "vendors" DROP COLUMN "supported_brands";

-- CreateTable
CREATE TABLE "brands" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BrandType" NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_VendorBrands" (
    "A" INTEGER NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_VendorBrands_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE INDEX "_VendorBrands_B_index" ON "_VendorBrands"("B");

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VendorBrands" ADD CONSTRAINT "_VendorBrands_A_fkey" FOREIGN KEY ("A") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VendorBrands" ADD CONSTRAINT "_VendorBrands_B_fkey" FOREIGN KEY ("B") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
