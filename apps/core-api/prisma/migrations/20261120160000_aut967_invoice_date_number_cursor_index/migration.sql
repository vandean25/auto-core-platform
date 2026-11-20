-- AUT-967: B-tree index for the invoice date cursor sort (date, invoice_number, id tiebreaker).

CREATE INDEX IF NOT EXISTS "invoices_tenant_id_date_invoice_number_id_idx"
  ON "invoices" ("tenant_id", "date", "invoice_number", "id");

DROP INDEX IF EXISTS "invoices_tenant_id_date_id_idx";
