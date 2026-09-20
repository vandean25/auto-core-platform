-- AUT-297: Per-entity accounting profile and source-category mapping scaffolding
CREATE TABLE "legal_entity_accounting_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "profile_code" TEXT,
    "format_version" TEXT,
    "chart" TEXT,
    "account_length" INTEGER,
    "advisor_number" TEXT,
    "client_number" TEXT,
    "fiscal_year_start_month" INTEGER,
    "default_debtor_account" TEXT,
    "mapping_rules" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_entity_accounting_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_entity_accounting_profiles_tenant_id_legal_entity_id_key" ON "legal_entity_accounting_profiles"("tenant_id", "legal_entity_id");
CREATE UNIQUE INDEX "legal_entity_accounting_profiles_tenant_id_id_key" ON "legal_entity_accounting_profiles"("tenant_id", "id");
CREATE INDEX "legal_entity_accounting_profiles_tenant_id_idx" ON "legal_entity_accounting_profiles"("tenant_id");

ALTER TABLE "legal_entity_accounting_profiles" ADD CONSTRAINT "legal_entity_accounting_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_entity_accounting_profiles" ADD CONSTRAINT "legal_entity_accounting_profiles_tenant_id_legal_entity_id_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "legal_entities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
