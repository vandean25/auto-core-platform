ALTER TYPE "PaymentMethod" ADD VALUE 'BANK_TRANSFER';

ALTER TABLE "payments"
    ADD COLUMN "bank_transaction_id" TEXT,
    ADD COLUMN "bank_confirm_version" INTEGER,
    ADD COLUMN "bank_invoice_revision" TEXT;

ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_bank_transaction_id_fkey"
    FOREIGN KEY ("tenant_id", "bank_transaction_id") REFERENCES "bank_transactions"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "payments_tenant_id_bank_transaction_id_status_idx"
    ON "payments"("tenant_id", "bank_transaction_id", "status");
