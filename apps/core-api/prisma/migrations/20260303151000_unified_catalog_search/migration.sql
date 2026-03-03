-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN "engine_code" TEXT;

-- CreateTable
CREATE TABLE "labor_operations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "standard_aw" DECIMAL(10,2) NOT NULL,
    "hourly_rate" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_fitments" (
    "id" TEXT NOT NULL,
    "labor_operation_id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year_from" INTEGER,
    "year_to" INTEGER,
    "engine_code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_fitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_parts" (
    "id" TEXT NOT NULL,
    "supplier_part_number" TEXT NOT NULL,
    "oem_number" TEXT,
    "description" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_fitments" (
    "id" TEXT NOT NULL,
    "master_part_id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year_from" INTEGER,
    "year_to" INTEGER,
    "engine_code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_fitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_inventories" (
    "id" TEXT NOT NULL,
    "master_part_id" TEXT NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "bin_location" TEXT,
    "cost_price" DECIMAL(10,2) NOT NULL,
    "retail_price" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_inventories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labor_operations_code_key" ON "labor_operations"("code");

-- CreateIndex
CREATE INDEX "labor_operations_description_idx" ON "labor_operations"("description");

-- CreateIndex
CREATE INDEX "labor_operations_code_description_idx" ON "labor_operations"("code", "description");

-- CreateIndex
CREATE INDEX "labor_fitments_labor_operation_id_idx" ON "labor_fitments"("labor_operation_id");

-- CreateIndex
CREATE INDEX "labor_fitments_make_model_year_from_year_to_engine_code_idx" ON "labor_fitments"("make", "model", "year_from", "year_to", "engine_code");

-- CreateIndex
CREATE UNIQUE INDEX "master_parts_supplier_part_number_key" ON "master_parts"("supplier_part_number");

-- CreateIndex
CREATE INDEX "master_parts_description_idx" ON "master_parts"("description");

-- CreateIndex
CREATE INDEX "master_parts_supplier_part_number_oem_number_description_idx" ON "master_parts"("supplier_part_number", "oem_number", "description");

-- CreateIndex
CREATE INDEX "part_fitments_master_part_id_idx" ON "part_fitments"("master_part_id");

-- CreateIndex
CREATE INDEX "part_fitments_make_model_year_from_year_to_engine_code_idx" ON "part_fitments"("make", "model", "year_from", "year_to", "engine_code");

-- CreateIndex
CREATE UNIQUE INDEX "local_inventories_master_part_id_key" ON "local_inventories"("master_part_id");

-- CreateIndex
CREATE INDEX "local_inventories_quantity_on_hand_idx" ON "local_inventories"("quantity_on_hand");

-- AddForeignKey
ALTER TABLE "labor_fitments" ADD CONSTRAINT "labor_fitments_labor_operation_id_fkey" FOREIGN KEY ("labor_operation_id") REFERENCES "labor_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_fitments" ADD CONSTRAINT "part_fitments_master_part_id_fkey" FOREIGN KEY ("master_part_id") REFERENCES "master_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_inventories" ADD CONSTRAINT "local_inventories_master_part_id_fkey" FOREIGN KEY ("master_part_id") REFERENCES "master_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
