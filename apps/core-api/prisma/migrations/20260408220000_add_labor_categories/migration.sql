-- CreateTable
CREATE TABLE "labor_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "parent_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "default_hourly_rate" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_categories_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "labor_operations" ADD COLUMN "category_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "labor_categories_name_key" ON "labor_categories"("name");

-- CreateIndex
CREATE INDEX "labor_categories_parent_id_idx" ON "labor_categories"("parent_id");

-- CreateIndex
CREATE INDEX "labor_operations_category_id_idx" ON "labor_operations"("category_id");

-- AddForeignKey
ALTER TABLE "labor_categories" ADD CONSTRAINT "labor_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "labor_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_operations" ADD CONSTRAINT "labor_operations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "labor_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
