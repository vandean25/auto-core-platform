-- CreateEnum
CREATE TYPE "TyreMeasurementSource" AS ENUM ('CAPTURE', 'LEGACY_TREAD_JSON');

-- AlterTable
ALTER TABLE "tyre_measurements" ADD COLUMN     "source" "TyreMeasurementSource" NOT NULL DEFAULT 'CAPTURE',
ADD COLUMN     "source_ref" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tyre_measurements_tenant_id_source_ref_key" ON "tyre_measurements"("tenant_id", "source_ref");

-- Legacy tread JSON carries only a middle-point value per position.
ALTER TABLE "tyre_wheel_readings" ALTER COLUMN "tread_inner_mm" DROP NOT NULL,
ALTER COLUMN "tread_outer_mm" DROP NOT NULL;
