-- AUT-589: granular purposes, scoped idempotency, sequence uniqueness, encrypted address, customer FK on tokens

CREATE TYPE "CustomerConsentPurpose_new" AS ENUM (
  'ORDER_COMMUNICATION',
  'INVOICE_DELIVERY',
  'PICKERL_REMINDER',
  'SERVICE_REMINDER',
  'REVIEW_REQUEST',
  'SEASONAL_OFFERS',
  'NEWSLETTER'
);

ALTER TABLE "customer_consents"
  ALTER COLUMN "purpose" TYPE "CustomerConsentPurpose_new"
  USING (
    CASE "purpose"::text
      WHEN 'TRANSACTIONAL' THEN 'ORDER_COMMUNICATION'
      WHEN 'MARKETING' THEN 'NEWSLETTER'
      ELSE "purpose"::text
    END
  )::"CustomerConsentPurpose_new";

DROP TYPE "CustomerConsentPurpose";
ALTER TYPE "CustomerConsentPurpose_new" RENAME TO "CustomerConsentPurpose";

ALTER TABLE "customer_contact_points" RENAME COLUMN "normalized_address" TO "encrypted_address";

DROP INDEX IF EXISTS "customer_consents_tenant_id_idempotency_key_key";

CREATE UNIQUE INDEX "customer_consents_tnt_ctrl_cust_idem_key"
  ON "customer_consents"("tenant_id", "controller_legal_entity_id", "customer_id", "idempotency_key");

CREATE UNIQUE INDEX "customer_consents_tnt_ctrl_cust_ch_purpose_seq"
  ON "customer_consents"("tenant_id", "controller_legal_entity_id", "customer_id", "channel", "purpose", "sequence");

ALTER TABLE "customer_consent_unsubscribe_tokens"
  ADD CONSTRAINT "customer_consent_unsubscribe_tokens_tenant_id_customer_id_fkey"
  FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
