-- AUT-967: B-tree indexes for the invoice date cursor sort (date, invoice_number, id tiebreaker).

CREATE INDEX IF NOT EXISTS "invoices_tenant_id_date_invoice_number_id_idx"
  ON "invoices" ("tenant_id", "date", "invoice_number", "id");

-- Date DESC with invoice_number DESC NULLS LAST (drafts have no number yet). A plain ascending index only
-- serves invoice_number DESC NULLS FIRST backwards, so the default list direction needs its own index.
-- Prisma cannot declare NULLS ordering in the schema; like the number sort index it lives only here.
CREATE INDEX IF NOT EXISTS "invoices_tenant_id_date_desc_number_desc_nulls_last_id_idx"
  ON "invoices" ("tenant_id", "date" DESC, "invoice_number" DESC NULLS LAST, "id" DESC);

DROP INDEX IF EXISTS "invoices_tenant_id_date_id_idx";
