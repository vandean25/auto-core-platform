-- AUT-1088: Backfill missing LegalEntity.payment_terms_days with 14 and enforce NOT NULL + >= 0.
DO $$
DECLARE
  affected_count INTEGER;
  affected_ids TEXT;
BEGIN
  SELECT COUNT(*), STRING_AGG(id::text, ', ')
  INTO affected_count, affected_ids
  FROM "legal_entities"
  WHERE "payment_terms_days" IS NULL;

  IF affected_count > 0 THEN
    RAISE NOTICE 'AUT-1088 backfill: setting payment_terms_days = 14 on % legal_entities: %', affected_count, affected_ids;
    UPDATE "legal_entities"
    SET "payment_terms_days" = 14
    WHERE "payment_terms_days" IS NULL;
  END IF;
END $$;

ALTER TABLE "legal_entities" ALTER COLUMN "payment_terms_days" SET DEFAULT 14;
ALTER TABLE "legal_entities" ALTER COLUMN "payment_terms_days" SET NOT NULL;
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_payment_terms_days_non_negative" CHECK ("payment_terms_days" >= 0);
