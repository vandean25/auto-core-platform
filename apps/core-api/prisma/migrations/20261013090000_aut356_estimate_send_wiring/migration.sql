-- AUT-356 phase 4: estimate send wiring. Expand-only (ADR-0025 section 11): new enum value, a column with a default, a new table.

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'CUSTOMER_ESTIMATE_SENT';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "contact_email_ok" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "workshop_estimate_approval_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workshop_estimate_version_id" TEXT NOT NULL,
    "token_sha256" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "invalidated_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workshop_estimate_approval_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wat_token_sha256_idx" ON "workshop_estimate_approval_tokens"("token_sha256");

-- CreateIndex
CREATE INDEX "workshop_estimate_approval_tokens_tenant_id_idx" ON "workshop_estimate_approval_tokens"("tenant_id");

-- CreateIndex
CREATE INDEX "wat_version_idx" ON "workshop_estimate_approval_tokens"("tenant_id", "workshop_estimate_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "wat_tenant_id_uq" ON "workshop_estimate_approval_tokens"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wat_tenant_token_sha256_uq" ON "workshop_estimate_approval_tokens"("tenant_id", "token_sha256");

-- AddForeignKey
ALTER TABLE "workshop_estimate_approval_tokens" ADD CONSTRAINT "wat_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_approval_tokens" ADD CONSTRAINT "wat_version_fkey" FOREIGN KEY ("tenant_id", "workshop_estimate_version_id") REFERENCES "workshop_estimate_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

