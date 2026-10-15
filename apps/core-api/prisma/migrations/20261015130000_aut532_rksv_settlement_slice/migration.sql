-- AUT-532: AT RKSV settlement slice (additive)

CREATE TYPE "RksvMode" AS ENUM ('OFF', 'UNKNOWN', 'REQUIRED_EXTERNAL_KASSE', 'REQUIRED_ACP_RKSV');
CREATE TYPE "FiscalRegisterEnv" AS ENUM ('TEST', 'LIVE');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'UNKNOWN', 'SETTLED', 'SETTLED_EXTERNAL', 'REJECTED', 'REVERSED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD');
CREATE TYPE "FiscalReceiptState" AS ENUM ('PENDING', 'UNKNOWN', 'SIGNED', 'REJECTED');
CREATE TYPE "FiscalReceiptType" AS ENUM ('NORMAL', 'CANCELLATION');

ALTER TABLE "legal_entities" ADD COLUMN "rksv_mode" "RksvMode" NOT NULL DEFAULT 'OFF';

CREATE TABLE "fiscal_registers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "env" "FiscalRegisterEnv" NOT NULL,
    "provider_cash_register_id" UUID NOT NULL,
    "provider_scu_id" UUID NOT NULL,
    "provider_state" TEXT NOT NULL,
    "credentials_secret_ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_registers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "recorded_by_user_id" TEXT,
    "status" "PaymentStatus" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "external_receipt_number" TEXT,
    "external_receipt_date" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fiscal_receipts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "fiscal_register_id" TEXT,
    "provider_receipt_id" UUID NOT NULL,
    "receipt_type" "FiscalReceiptType" NOT NULL,
    "state" "FiscalReceiptState" NOT NULL,
    "request_body" JSONB NOT NULL,
    "response_body" JSONB,
    "provider_http_status" INTEGER,
    "provider_error_code" TEXT,
    "provider_request_id" TEXT,
    "original_fiscal_receipt_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_registers_tenant_id_site_id_key" ON "fiscal_registers"("tenant_id", "site_id");
CREATE UNIQUE INDEX "fiscal_registers_tenant_id_id_key" ON "fiscal_registers"("tenant_id", "id");
CREATE INDEX "fiscal_registers_tenant_id_idx" ON "fiscal_registers"("tenant_id");

CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_key" ON "payments"("tenant_id", "idempotency_key");
CREATE INDEX "payments_tenant_id_invoice_id_status_idx" ON "payments"("tenant_id", "invoice_id", "status");
CREATE UNIQUE INDEX "payments_tenant_id_id_key" ON "payments"("tenant_id", "id");

CREATE UNIQUE INDEX "fiscal_receipts_tenant_id_provider_receipt_id_key" ON "fiscal_receipts"("tenant_id", "provider_receipt_id");
CREATE INDEX "fiscal_receipts_tenant_id_fiscal_register_id_createdAt_idx" ON "fiscal_receipts"("tenant_id", "fiscal_register_id", "createdAt");
CREATE UNIQUE INDEX "fiscal_receipts_tenant_id_id_key" ON "fiscal_receipts"("tenant_id", "id");

ALTER TABLE "fiscal_registers" ADD CONSTRAINT "fiscal_registers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_registers" ADD CONSTRAINT "fiscal_registers_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_registers" ADD CONSTRAINT "fiscal_registers_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_invoice_id_fkey" FOREIGN KEY ("tenant_id", "invoice_id") REFERENCES "invoices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_tenant_id_fiscal_register_id_fkey" FOREIGN KEY ("tenant_id", "fiscal_register_id") REFERENCES "fiscal_registers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_tenant_id_original_fiscal_receipt_id_fkey" FOREIGN KEY ("tenant_id", "original_fiscal_receipt_id") REFERENCES "fiscal_receipts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
