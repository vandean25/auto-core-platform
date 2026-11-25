-- AUT-1048: Valued stock corrections with reason, immutability and Gegenbuchung

CREATE TYPE "StockAdjustmentReason" AS ENUM (
  'INVENTORY_COUNT',
  'BREAKAGE',
  'SHRINKAGE',
  'FOUND',
  'BOOKING_ERROR',
  'OTHER'
);

CREATE TYPE "StockAdjustmentValueSource" AS ENUM (
  'AVG',
  'LAST_EK',
  'MANUAL'
);

ALTER TABLE "inventory_transactions"
  ADD COLUMN "reason" "StockAdjustmentReason",
  ADD COLUMN "note" TEXT,
  ADD COLUMN "value_source" "StockAdjustmentValueSource",
  ADD COLUMN "override_reason" TEXT,
  ADD COLUMN "created_by_user_id" TEXT,
  ADD COLUMN "reversal_of_transaction_id" TEXT;

CREATE UNIQUE INDEX "inventory_transactions_tenant_id_reversal_of_transaction_id_key"
  ON "inventory_transactions"("tenant_id", "reversal_of_transaction_id");

CREATE INDEX "inventory_transactions_created_by_user_id_idx"
  ON "inventory_transactions"("created_by_user_id");

ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_reversal_of_transaction_id_fkey"
  FOREIGN KEY ("reversal_of_transaction_id") REFERENCES "inventory_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutability trigger: forbid UPDATE and DELETE on inventory_transactions.
-- Only the documented test/purge exception (acp.allow_purge = 'on') may DELETE rows.
CREATE FUNCTION prevent_inventory_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('acp.allow_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'inventory_transactions is immutable (delete blocked)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
    AND current_setting('acp.allow_purge', true) = 'on'
    AND NEW."reversal_of_transaction_id" IS NULL
    AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."tenant_id" IS NOT DISTINCT FROM OLD."tenant_id"
    AND NEW."site_id" IS NOT DISTINCT FROM OLD."site_id"
    AND NEW."item_id" IS NOT DISTINCT FROM OLD."item_id"
    AND NEW."location_id" IS NOT DISTINCT FROM OLD."location_id"
    AND NEW."quantity" IS NOT DISTINCT FROM OLD."quantity"
    AND NEW."type" IS NOT DISTINCT FROM OLD."type"
    AND NEW."cost_basis" IS NOT DISTINCT FROM OLD."cost_basis"
    AND NEW."reason" IS NOT DISTINCT FROM OLD."reason"
    AND NEW."note" IS NOT DISTINCT FROM OLD."note"
    AND NEW."value_source" IS NOT DISTINCT FROM OLD."value_source"
    AND NEW."override_reason" IS NOT DISTINCT FROM OLD."override_reason"
    AND NEW."created_by_user_id" IS NOT DISTINCT FROM OLD."created_by_user_id" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'inventory_transactions is immutable (update blocked)'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER inventory_transactions_immutable
BEFORE UPDATE OR DELETE ON "inventory_transactions"
FOR EACH ROW
EXECUTE FUNCTION prevent_inventory_transaction_mutation();
