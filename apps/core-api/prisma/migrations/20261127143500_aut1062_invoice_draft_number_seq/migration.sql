ALTER TABLE "invoices"
ADD COLUMN "draft_number_seq" INTEGER GENERATED ALWAYS AS (
  CASE
    WHEN substring("draft_number" FROM '(\d+)$') ~ '^\d{1,9}$'
    THEN substring("draft_number" FROM '(\d+)$')::integer
    ELSE NULL
  END
) STORED;

CREATE INDEX "invoices_tenant_id_invoice_number_draft_number_seq_id_idx"
ON "invoices"("tenant_id", "invoice_number", "draft_number_seq", "id");
