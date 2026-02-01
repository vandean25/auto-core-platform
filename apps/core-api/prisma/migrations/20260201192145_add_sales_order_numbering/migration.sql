-- AlterTable
ALTER TABLE "finance_settings" ADD COLUMN     "next_sales_order_number" INTEGER NOT NULL DEFAULT 1001,
ADD COLUMN     "sales_order_prefix" TEXT NOT NULL DEFAULT 'SO-2026-';
