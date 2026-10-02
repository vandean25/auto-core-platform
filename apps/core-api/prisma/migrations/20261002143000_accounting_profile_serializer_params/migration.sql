-- AUT-350 step 1: expand-only profile fields for non-DATEV serializer parameters
ALTER TABLE "legal_entity_accounting_profiles"
ADD COLUMN "serializer_params" JSONB NOT NULL DEFAULT '{}';
