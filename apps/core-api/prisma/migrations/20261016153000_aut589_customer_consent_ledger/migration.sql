-- AUT-589: Customer consent ledger (append-only) and communication state

CREATE TYPE "CustomerConsentPurpose" AS ENUM ('TRANSACTIONAL', 'MARKETING');
CREATE TYPE "CustomerConsentChannel" AS ENUM ('EMAIL', 'SMS', 'PHONE', 'POST');
CREATE TYPE "CustomerConsentStatus" AS ENUM ('GRANTED', 'REVOKED', 'SOFT_OPT_IN');
CREATE TYPE "CustomerConsentBasis" AS ENUM ('CONTRACT', 'LEGAL_OBLIGATION', 'CONSENT', 'LEGITIMATE_INTEREST');
CREATE TYPE "CustomerConsentSource" AS ENUM ('INTAKE', 'PROFILE', 'WEB_FORM', 'IMPORT', 'LEGACY_MIGRATION', 'UNSUBSCRIBE', 'PROVIDER', 'SYSTEM');
CREATE TYPE "CustomerContactTransportValidity" AS ENUM ('UNKNOWN', 'VALID', 'INVALID');
CREATE TYPE "CustomerCommunicationProcessingStatus" AS ENUM ('ACTIVE', 'RESTRICTED', 'ERASURE_PENDING', 'TOMBSTONED');

CREATE TABLE "customer_contact_points" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel" "CustomerConsentChannel" NOT NULL,
    "normalized_address" TEXT NOT NULL,
    "address_fingerprint" TEXT NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "transport_validity" "CustomerContactTransportValidity" NOT NULL DEFAULT 'UNKNOWN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contact_points_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_communication_states" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "controller_legal_entity_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "processing_status" "CustomerCommunicationProcessingStatus" NOT NULL DEFAULT 'ACTIVE',
    "preferred_service_channel" "CustomerConsentChannel",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_communication_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_consents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "controller_legal_entity_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "contact_point_id" TEXT,
    "channel" "CustomerConsentChannel" NOT NULL,
    "purpose" "CustomerConsentPurpose" NOT NULL,
    "status" "CustomerConsentStatus" NOT NULL,
    "basis" "CustomerConsentBasis",
    "sequence" INTEGER NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "source" "CustomerConsentSource" NOT NULL,
    "actor_member_id" TEXT,
    "text_version" TEXT,
    "text_language" VARCHAR(8),
    "text_snapshot" TEXT,
    "text_content_hash" TEXT,
    "evidence" JSONB,
    "supersedes_event_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "idempotency_key" TEXT,
    "retain_until" TIMESTAMP(3),
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_consent_unsubscribe_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "controller_legal_entity_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel" "CustomerConsentChannel" NOT NULL,
    "contact_fingerprint" TEXT NOT NULL,
    "token_sha256" TEXT NOT NULL,
    "retain_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "customer_consent_unsubscribe_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_contact_points_tenant_id_id_key" ON "customer_contact_points"("tenant_id", "id");
CREATE UNIQUE INDEX "customer_contact_points_tenant_id_customer_id_channel_address_fingerprint_key" ON "customer_contact_points"("tenant_id", "customer_id", "channel", "address_fingerprint");
CREATE INDEX "customer_contact_points_tenant_id_customer_id_channel_is_current_idx" ON "customer_contact_points"("tenant_id", "customer_id", "channel", "is_current");

CREATE UNIQUE INDEX "customer_communication_states_tenant_id_controller_legal_entity_id_customer_id_key" ON "customer_communication_states"("tenant_id", "controller_legal_entity_id", "customer_id");
CREATE UNIQUE INDEX "customer_communication_states_tenant_id_id_key" ON "customer_communication_states"("tenant_id", "id");

CREATE UNIQUE INDEX "customer_consents_tenant_id_id_key" ON "customer_consents"("tenant_id", "id");
CREATE UNIQUE INDEX "customer_consents_tenant_id_idempotency_key_key" ON "customer_consents"("tenant_id", "idempotency_key");
CREATE INDEX "customer_consents_tenant_id_customer_id_controller_legal_entity_id_channel_purpose_sequence_idx" ON "customer_consents"("tenant_id", "customer_id", "controller_legal_entity_id", "channel", "purpose", "sequence");
CREATE INDEX "customer_consents_tenant_id_retain_until_legal_hold_idx" ON "customer_consents"("tenant_id", "retain_until", "legal_hold");

CREATE UNIQUE INDEX "customer_consent_unsubscribe_tokens_tenant_id_id_key" ON "customer_consent_unsubscribe_tokens"("tenant_id", "id");
CREATE UNIQUE INDEX "customer_consent_unsubscribe_tokens_tenant_id_token_sha256_key" ON "customer_consent_unsubscribe_tokens"("tenant_id", "token_sha256");
CREATE INDEX "customer_consent_unsubscribe_tokens_tenant_id_customer_id_idx" ON "customer_consent_unsubscribe_tokens"("tenant_id", "customer_id");

ALTER TABLE "customer_contact_points" ADD CONSTRAINT "customer_contact_points_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_contact_points" ADD CONSTRAINT "customer_contact_points_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_communication_states" ADD CONSTRAINT "customer_communication_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_communication_states" ADD CONSTRAINT "customer_communication_states_tenant_id_controller_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "controller_legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_communication_states" ADD CONSTRAINT "customer_communication_states_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_tenant_id_controller_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "controller_legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_tenant_id_contact_point_id_fkey" FOREIGN KEY ("tenant_id", "contact_point_id") REFERENCES "customer_contact_points"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_consent_unsubscribe_tokens" ADD CONSTRAINT "customer_consent_unsubscribe_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_consent_unsubscribe_tokens" ADD CONSTRAINT "customer_consent_unsubscribe_tokens_tenant_id_controller_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "controller_legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
