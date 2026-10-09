-- AUT-413: decision live-apply (expand-only).
-- Adds nullable columns and platform default policy rows. No existing row is rewritten.

-- Tenant opt-out for live-apply. Only 'shadow' is valid; NULL inherits the environment.
ALTER TABLE "tenants" ADD COLUMN "decision_apply_mode" VARCHAR(16);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_decision_apply_mode_check"
  CHECK ("decision_apply_mode" IS NULL OR "decision_apply_mode" = 'shadow');

-- Document type set by live-apply once decided. NULL until then.
ALTER TABLE "document_brand_assets" ADD COLUMN "document_sort_type" VARCHAR(32);
ALTER TABLE "document_brand_assets" ADD CONSTRAINT "document_brand_assets_document_sort_type_check"
  CHECK (
    "document_sort_type" IS NULL OR "document_sort_type" IN (
      'Rechnung', 'Lieferschein', 'Kostenvoranschlag', 'Fahrzeugschein', 'Sonstiges'
    )
  );

-- Platform default tiers. PROPOSE: a person approves each suggestion in Approvals.
INSERT INTO "agent_policy_rules" (
  "id", "tenant_id", "action_type", "tier", "conditions_json", "enabled", "version", "created_by", "created_at", "updated_at"
) VALUES
  (gen_random_uuid(), NULL, 'decision.import_row_match', 'PROPOSE', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'decision.document_sort', 'PROPOSE', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
