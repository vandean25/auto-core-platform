-- AUT-1043: Custom fields for customers and vehicles (definitions, JSON columns, per-tenant feature flag).

ALTER TABLE "tenants" ADD COLUMN "custom_fields_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "customers" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "vehicles" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';

CREATE TYPE "CustomFieldEntity" AS ENUM ('CUSTOMER', 'VEHICLE');

CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN');

CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity" "CustomFieldEntity" NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" JSONB,
    "purpose" VARCHAR(500) NOT NULL,
    "personal_data" BOOLEAN NOT NULL DEFAULT true,
    "retention_class" VARCHAR(64) NOT NULL DEFAULT 'PARENT_OBJECT',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_field_definitions_tenant_id_entity_key_key"
  ON "custom_field_definitions"("tenant_id", "entity", "key");

CREATE INDEX "custom_field_definitions_tenant_id_entity_archived_sort_order_idx"
  ON "custom_field_definitions"("tenant_id", "entity", "archived", "sort_order");

ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
