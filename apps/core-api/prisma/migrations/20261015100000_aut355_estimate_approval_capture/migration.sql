-- AUT-355 (ADR-0025 §1, §7, §11): advisor-recorded estimate approvals and overrun tracking.
-- Expand-only: enum values and a new enum are added, approval evidence gets nullable columns, and one new tenant
-- table holds the overrun state of an approved baseline. No existing row or column changes.

-- CreateEnum
CREATE TYPE "EstimateCustomerReaction" AS ENUM ('AGREED', 'DECLINED', 'QUESTIONED', 'CALLBACK_REQUESTED', 'NO_RESPONSE');

-- CreateEnum
CREATE TYPE "EstimateNotificationChannel" AS ENUM ('PHONE', 'IN_PERSON', 'EMAIL');

-- AlterEnum
ALTER TYPE "EstimateApprovalChannel" ADD VALUE 'PHONE';

-- AlterEnum
ALTER TYPE "EstimateApprovalChannel" ADD VALUE 'IN_PERSON';

-- AlterEnum
ALTER TYPE "EstimateApprovalChannel" ADD VALUE 'EMAIL';

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'CUSTOMER_ESTIMATE_DECIDED';

-- AlterTable
ALTER TABLE "workshop_estimate_approvals" ADD COLUMN "amount_quoted_gross" DECIMAL(10,2),
ADD COLUMN "customer_reaction" "EstimateCustomerReaction",
ADD COLUMN "note" VARCHAR(500),
ADD COLUMN "recorded_by_user_id" TEXT;

-- CreateTable
CREATE TABLE "workshop_estimate_overruns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workshop_estimate_version_id" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "approved_total_gross" DECIMAL(10,2) NOT NULL,
    "detected_total_gross" DECIMAL(10,2) NOT NULL,
    "total_over_threshold" BOOLEAN NOT NULL DEFAULT false,
    "new_work_lines" BOOLEAN NOT NULL DEFAULT false,
    "notified_at" TIMESTAMP(3),
    "notified_channel" "EstimateNotificationChannel",
    "notified_by_user_id" TEXT,
    "notified_amount_gross" DECIMAL(10,2),
    "customer_reaction" "EstimateCustomerReaction",
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_estimate_overruns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workshop_estimate_overruns_tenant_id_idx" ON "workshop_estimate_overruns"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "weo_tenant_id_uq" ON "workshop_estimate_overruns"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "weo_tenant_version_uq" ON "workshop_estimate_overruns"("tenant_id", "workshop_estimate_version_id");

-- AddForeignKey
ALTER TABLE "workshop_estimate_approvals" ADD CONSTRAINT "workshop_estimate_approvals_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_overruns" ADD CONSTRAINT "weo_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_overruns" ADD CONSTRAINT "weo_version_fkey" FOREIGN KEY ("tenant_id", "workshop_estimate_version_id") REFERENCES "workshop_estimate_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_overruns" ADD CONSTRAINT "workshop_estimate_overruns_notified_by_user_id_fkey" FOREIGN KEY ("notified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
