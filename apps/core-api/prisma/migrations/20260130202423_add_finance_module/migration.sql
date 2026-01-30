-- AlterTable
ALTER TABLE "catalog_items" ADD COLUMN     "revenue_group_id" INTEGER;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "revenue_group_name" TEXT;

-- CreateTable
CREATE TABLE "revenue_groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "account_number" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 1,
    "lock_date" TIMESTAMP(3),
    "next_invoice_number" INTEGER NOT NULL DEFAULT 1001,
    "invoice_prefix" TEXT NOT NULL DEFAULT 'RE-2026-',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "revenue_groups_name_key" ON "revenue_groups"("name");

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_revenue_group_id_fkey" FOREIGN KEY ("revenue_group_id") REFERENCES "revenue_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
