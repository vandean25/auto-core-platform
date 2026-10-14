-- Expand-only (ADR-0025 §7, AUT-373): evidence rows for a decision on a sent estimate version, written by the
-- public approval route and, later, the advisor-recorded path (AUT-355). New enums and one new table with composite
-- tenant foreign keys and tenant-leading unique constraints. No existing row or column changes.

-- CreateEnum
CREATE TYPE "EstimateApprovalChannel" AS ENUM ('LINK', 'ADVISOR_RECORDED');

-- CreateEnum
CREATE TYPE "EstimateApprovalDecision" AS ENUM ('APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "workshop_estimate_approvals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workshop_estimate_version_id" TEXT NOT NULL,
    "approval_token_id" TEXT,
    "channel" "EstimateApprovalChannel" NOT NULL,
    "decision" "EstimateApprovalDecision" NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "pdf_sha256" TEXT,
    "legal_text_version" TEXT NOT NULL,
    "legal_text_sha256" TEXT NOT NULL,
    "recipient_email" TEXT,
    "typed_full_name" TEXT,
    "legal_blocks_accepted" BOOLEAN NOT NULL DEFAULT false,
    "b2c_declaration_accepted" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "accept_language" TEXT,
    "confirmation_email_sent_at" TIMESTAMP(3),
    "confirmation_provider_message_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workshop_estimate_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workshop_estimate_approvals_tenant_id_idx" ON "workshop_estimate_approvals"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "wea_tenant_id_uq" ON "workshop_estimate_approvals"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wea_tenant_version_uq" ON "workshop_estimate_approvals"("tenant_id", "workshop_estimate_version_id");

-- AddForeignKey
ALTER TABLE "workshop_estimate_approvals" ADD CONSTRAINT "wea_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_approvals" ADD CONSTRAINT "wea_version_fkey" FOREIGN KEY ("tenant_id", "workshop_estimate_version_id") REFERENCES "workshop_estimate_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_estimate_approvals" ADD CONSTRAINT "wea_token_fkey" FOREIGN KEY ("tenant_id", "approval_token_id") REFERENCES "workshop_estimate_approval_tokens"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

