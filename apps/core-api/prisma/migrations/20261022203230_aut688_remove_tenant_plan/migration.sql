-- Contract: remove Tenant.plan and enum TenantPlan (AUT-688). No feature was gated on it; values are discarded by design.

/*
  Warnings:

  - You are about to drop the column `plan` on the `tenants` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "plan";

-- DropEnum
DROP TYPE "TenantPlan";
