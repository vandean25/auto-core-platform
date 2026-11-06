-- AUT-891: additive B-tree indexes for the ADR-0035 keyset invoice list sorts (invoice number, invoice date).

CREATE INDEX IF NOT EXISTS "invoices_tenant_id_invoice_number_id_idx"
  ON "invoices" ("tenant_id", "invoice_number", "id");

CREATE INDEX IF NOT EXISTS "invoices_tenant_id_date_id_idx"
  ON "invoices" ("tenant_id", "date", "id");

-- Number DESC with NULLS LAST (drafts have no number yet, ADR-0035 §2). A plain ascending index only serves
-- DESC NULLS FIRST backwards, so this sort needs its own index. Prisma cannot declare NULLS ordering in the
-- schema; like the partial indexes of earlier migrations it lives only here.
CREATE INDEX IF NOT EXISTS "invoices_tenant_id_invoice_number_desc_nulls_last_id_idx"
  ON "invoices" ("tenant_id", "invoice_number" DESC NULLS LAST, "id" DESC);
