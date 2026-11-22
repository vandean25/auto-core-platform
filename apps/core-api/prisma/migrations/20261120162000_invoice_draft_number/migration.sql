CREATE SEQUENCE "invoice_draft_number_seq";

ALTER TABLE "invoices"
ADD COLUMN "draft_number" TEXT NOT NULL DEFAULT ('RE-D-'::text || (nextval('invoice_draft_number_seq'::regclass))::text);

ALTER SEQUENCE "invoice_draft_number_seq" OWNED BY "invoices"."draft_number";

CREATE UNIQUE INDEX "invoices_tenant_id_draft_number_key" ON "invoices"("tenant_id", "draft_number");
