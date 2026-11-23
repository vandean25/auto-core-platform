-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- AlterTable
ALTER TABLE "finance_settings" ADD COLUMN "bank_reconciliation_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "receiving_iban" TEXT NOT NULL,
    "statement_id" TEXT,
    "format" TEXT NOT NULL DEFAULT 'camt.053',
    "total_entries" INTEGER NOT NULL DEFAULT 0,
    "credit_entries" INTEGER NOT NULL DEFAULT 0,
    "debit_entries" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "receiving_iban" TEXT NOT NULL,
    "booking_date" DATE NOT NULL,
    "value_date" DATE,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "is_credit" BOOLEAN NOT NULL,
    "non_eur" BOOLEAN NOT NULL DEFAULT false,
    "remitter_name" TEXT,
    "remitter_iban_fingerprint" TEXT,
    "remitter_iban_last4" TEXT,
    "reference_text" TEXT,
    "bank_ref" TEXT NOT NULL,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'UNMATCHED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statement_imports_tenant_id_createdAt_idx" ON "bank_statement_imports"("tenant_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_imports_tenant_id_id_key" ON "bank_statement_imports"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_imports_tenant_id_legal_entity_id_file_sha25_key" ON "bank_statement_imports"("tenant_id", "legal_entity_id", "file_sha256");

-- CreateIndex
CREATE INDEX "bank_transactions_tenant_id_status_booking_date_id_idx" ON "bank_transactions"("tenant_id", "status", "booking_date" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "bank_transactions_tenant_id_booking_date_id_idx" ON "bank_transactions"("tenant_id", "booking_date" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "bank_transactions_tenant_id_legal_entity_id_booking_date_id_idx" ON "bank_transactions"("tenant_id", "legal_entity_id", "booking_date" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_tenant_id_id_key" ON "bank_transactions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_tenant_id_legal_entity_id_receiving_iban__key" ON "bank_transactions"("tenant_id", "legal_entity_id", "receiving_iban", "bank_ref");

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_import_id_fkey" FOREIGN KEY ("tenant_id", "import_id") REFERENCES "bank_statement_imports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
