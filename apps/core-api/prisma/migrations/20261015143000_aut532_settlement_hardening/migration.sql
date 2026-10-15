-- AUT-532: cancellation idempotency outside sign body; fiscal register binding required

ALTER TABLE "fiscal_receipts" ADD COLUMN "sign_idempotency_key" TEXT;

CREATE UNIQUE INDEX "fiscal_receipts_tenant_id_sign_idempotency_key_key"
  ON "fiscal_receipts"("tenant_id", "sign_idempotency_key")
  WHERE "sign_idempotency_key" IS NOT NULL;

ALTER TABLE "fiscal_receipts" ALTER COLUMN "fiscal_register_id" SET NOT NULL;
