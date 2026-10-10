-- AUT-464: Garantie/Kulanz claim file on a workshop order (internal record, no OEM portal integration).
-- Expand-only: two enums and two new tables. No existing table, row or index is changed.

-- CreateEnum
CREATE TYPE "WarrantyClaimType" AS ENUM ('GARANTIE', 'KULANZ', 'GEWAEHRLEISTUNG');

-- CreateEnum
CREATE TYPE "WarrantyClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED_EXTERNALLY', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateTable
CREATE TABLE "warranty_claims" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workshop_order_id" TEXT NOT NULL,
    "type" "WarrantyClaimType" NOT NULL,
    "status" "WarrantyClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "complaint" TEXT,
    "cause_correction" TEXT,
    "claimed_amount_net" DECIMAL(12,2),
    "external_reference" TEXT,
    "decision_date" DATE,
    "decision_note" TEXT,
    "submitted_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claim_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "warranty_claim_id" TEXT NOT NULL,
    "workshop_task_line_item_id" TEXT NOT NULL,
    "line_type" "WorkshopLineItemType" NOT NULL,
    "item_no" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranty_claim_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claims_tenant_id_id_key" ON "warranty_claims"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "warranty_claims_tenant_id_idx" ON "warranty_claims"("tenant_id");

-- CreateIndex
CREATE INDEX "warranty_claims_tenant_id_workshop_order_id_status_idx" ON "warranty_claims"("tenant_id", "workshop_order_id", "status");

-- CreateIndex
CREATE INDEX "warranty_claim_lines_tenant_id_idx" ON "warranty_claim_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "warranty_claim_lines_tenant_id_workshop_task_line_item_id_idx" ON "warranty_claim_lines"("tenant_id", "workshop_task_line_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claim_lines_claim_item_key" ON "warranty_claim_lines"("tenant_id", "warranty_claim_id", "workshop_task_line_item_id");

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_tenant_id_workshop_order_id_fkey" FOREIGN KEY ("tenant_id", "workshop_order_id") REFERENCES "workshop_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim_lines" ADD CONSTRAINT "warranty_claim_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim_lines" ADD CONSTRAINT "warranty_claim_lines_tenant_id_warranty_claim_id_fkey" FOREIGN KEY ("tenant_id", "warranty_claim_id") REFERENCES "warranty_claims"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim_lines" ADD CONSTRAINT "warranty_claim_lines_workshop_task_line_item_id_fkey" FOREIGN KEY ("workshop_task_line_item_id") REFERENCES "workshop_task_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
