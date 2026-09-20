-- AUT-297: Extend LegalEntity with DACH seller identity fields (nullable additive)
ALTER TABLE "legal_entities" ADD COLUMN "address_street" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "address_line2" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "address_zip" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "address_city" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "tax_number" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "vat_id" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "iban" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "bic" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "bank_name" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "email" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "phone" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "registration_number" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "registration_court" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "representatives" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "payment_terms_days" INTEGER;
ALTER TABLE "legal_entities" ADD COLUMN "payment_terms_text" TEXT;
