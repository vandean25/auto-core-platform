-- CreateEnum
CREATE TYPE "RegistrationDocumentIntakeState" AS ENUM ('UPLOADED', 'QUEUED', 'RUNNING', 'AWAITING_REVIEW', 'FAILED', 'ABORTED', 'APPLIED');

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN "national_code" VARCHAR(16);

-- CreateIndex
CREATE INDEX "vehicles_tenant_id_national_code_idx" ON "vehicles"("tenant_id", "national_code");

-- CreateTable
CREATE TABLE "registration_document_intakes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "captured_by_user_id" TEXT NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "state" "RegistrationDocumentIntakeState" NOT NULL,
    "document_kind" VARCHAR(32),
    "failure_code" VARCHAR(64),
    "evidence" JSONB,
    "match_snapshot" JSONB,
    "lease_token" VARCHAR(64),
    "provider_id" VARCHAR(64),
    "prompt_version" VARCHAR(64),
    "applied_customer_id" TEXT,
    "applied_vehicle_id" TEXT,
    "applied_workshop_order_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registration_document_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_intake_byte_purges" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "intake_id" TEXT NOT NULL,
    "object_prefix" VARCHAR(256) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "registration_intake_byte_purges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registration_document_intakes_tenant_id_id_key" ON "registration_document_intakes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_document_intakes_tenant_id_captured_by_user_id_s_key" ON "registration_document_intakes"("tenant_id", "captured_by_user_id", "site_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "registration_document_intakes_tenant_id_site_id_createdAt_idx" ON "registration_document_intakes"("tenant_id", "site_id", "createdAt");

-- CreateIndex
CREATE INDEX "registration_document_intakes_expires_at_idx" ON "registration_document_intakes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "registration_intake_byte_purges_tenant_id_id_key" ON "registration_intake_byte_purges"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_intake_byte_purges_intake_id_key" ON "registration_intake_byte_purges"("intake_id");

-- CreateIndex
CREATE INDEX "registration_intake_byte_purges_pending_idx" ON "registration_intake_byte_purges"("created_at") WHERE "processed_at" IS NULL;

-- AddForeignKey
ALTER TABLE "registration_document_intakes" ADD CONSTRAINT "registration_document_intakes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_document_intakes" ADD CONSTRAINT "registration_document_intakes_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_document_intakes" ADD CONSTRAINT "registration_document_intakes_captured_by_user_id_fkey" FOREIGN KEY ("captured_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_document_intakes" ADD CONSTRAINT "registration_document_intakes_applied_customer_id_fkey" FOREIGN KEY ("applied_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_document_intakes" ADD CONSTRAINT "registration_document_intakes_applied_vehicle_id_fkey" FOREIGN KEY ("applied_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_document_intakes" ADD CONSTRAINT "registration_document_intakes_applied_workshop_order_id_fkey" FOREIGN KEY ("applied_workshop_order_id") REFERENCES "workshop_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_intake_byte_purges" ADD CONSTRAINT "registration_intake_byte_purges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_intake_byte_purges" ADD CONSTRAINT "registration_intake_byte_purges_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "registration_document_intakes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
