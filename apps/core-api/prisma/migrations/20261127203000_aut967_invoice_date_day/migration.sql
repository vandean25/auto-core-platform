-- AUT-967: compare invoice dates on the Europe/Vienna calendar day so same-day invoices tie-break by invoice_number.
ALTER TABLE "invoices"
ADD COLUMN "date_day" DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Vienna')::date;

CREATE OR REPLACE FUNCTION set_invoice_date_day()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.date_day := ((NEW."date" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Vienna')::date;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_set_date_day
BEFORE INSERT OR UPDATE OF "date" ON "invoices"
FOR EACH ROW
EXECUTE FUNCTION set_invoice_date_day();

UPDATE "invoices"
SET "date_day" = (("date" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Vienna')::date;

CREATE INDEX "invoices_tenant_id_date_day_invoice_number_id_idx"
ON "invoices"("tenant_id", "date_day", "invoice_number", "id");
