-- AUT-298: Persist invoice ownership and per-line accounting snapshots for v2 issuance.

ALTER TABLE "invoices"
  ADD COLUMN "site_id" TEXT,
  ADD COLUMN "legal_entity_id" TEXT,
  ADD COLUMN "supply_date_from" DATE,
  ADD COLUMN "supply_date_to" DATE,
  ADD COLUMN "currency" TEXT DEFAULT 'EUR';

ALTER TABLE "invoice_items"
  ADD COLUMN "accounting_snapshot" JSONB;

CREATE INDEX "invoices_tenant_id_site_id_date_idx"
  ON "invoices"("tenant_id", "site_id", "date");

CREATE INDEX "invoices_tenant_id_legal_entity_id_date_idx"
  ON "invoices"("tenant_id", "legal_entity_id", "date");

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_tenant_id_site_id_fkey"
  FOREIGN KEY ("tenant_id", "site_id")
  REFERENCES "sites"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_tenant_id_legal_entity_id_fkey"
  FOREIGN KEY ("tenant_id", "legal_entity_id")
  REFERENCES "legal_entities"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
