-- CreateEnum
CREATE TYPE "AgentPolicyTier" AS ENUM ('AUTO', 'PROPOSE', 'HUMAN_ONLY');

-- CreateTable
CREATE TABLE "agent_policy_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "action_type" TEXT NOT NULL,
    "tier" "AgentPolicyTier" NOT NULL,
    "conditions_json" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_policy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_policy_rules_tenant_id_id_key" ON "agent_policy_rules"("tenant_id", "id");

-- NULLS NOT DISTINCT: one platform row per (action_type, version)
CREATE UNIQUE INDEX "agent_policy_rules_tenant_id_action_type_version_key"
ON "agent_policy_rules"("tenant_id", "action_type", "version") NULLS NOT DISTINCT;

CREATE INDEX "agent_policy_rules_tenant_id_action_type_idx" ON "agent_policy_rules"("tenant_id", "action_type");

-- AddForeignKey
ALTER TABLE "agent_policy_rules" ADD CONSTRAINT "agent_policy_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION agent_policy_tier_rank(tier "AgentPolicyTier")
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE tier
    WHEN 'AUTO' THEN 0
    WHEN 'PROPOSE' THEN 1
    WHEN 'HUMAN_ONLY' THEN 2
  END;
$$;

CREATE OR REPLACE FUNCTION enforce_agent_policy_tenant_tier_stricter()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  platform_row agent_policy_rules%ROWTYPE;
  platform_amount_max numeric;
  platform_customer_facing boolean;
  candidate_customer_facing boolean;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO platform_row
  FROM agent_policy_rules apr
  WHERE apr.tenant_id IS NULL
    AND apr.action_type = NEW.action_type
  ORDER BY apr.version DESC
  LIMIT 1;

  IF platform_row.id IS NULL OR platform_row.enabled = false THEN
    RETURN NEW;
  END IF;

  IF agent_policy_tier_rank(NEW.tier) < agent_policy_tier_rank(platform_row.tier) THEN
    RAISE EXCEPTION 'agent_policy_tenant_tier_looser_than_platform'
      USING ERRCODE = 'check_violation';
  END IF;

  IF jsonb_typeof(platform_row.conditions_json->'amount_max') = 'number' THEN
    platform_amount_max := (platform_row.conditions_json->>'amount_max')::numeric;
    IF jsonb_typeof(NEW.conditions_json->'amount_max') IS DISTINCT FROM 'number'
       OR (NEW.conditions_json->>'amount_max')::numeric > platform_amount_max THEN
      RAISE EXCEPTION 'agent_policy_tenant_tier_looser_than_platform'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  platform_customer_facing := COALESCE(
    (platform_row.conditions_json->>'customer_facing')::boolean,
    false
  );
  candidate_customer_facing := COALESCE(
    (NEW.conditions_json->>'customer_facing')::boolean,
    false
  );

  IF platform_customer_facing AND NOT candidate_customer_facing THEN
    RAISE EXCEPTION 'agent_policy_tenant_tier_looser_than_platform'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_policy_rules_tenant_tier_stricter
BEFORE INSERT OR UPDATE ON agent_policy_rules
FOR EACH ROW
EXECUTE FUNCTION enforce_agent_policy_tenant_tier_stricter();

-- Platform default policy rows (tenant_id NULL)
INSERT INTO "agent_policy_rules" (
  "id", "tenant_id", "action_type", "tier", "conditions_json", "enabled", "version", "created_by", "created_at", "updated_at"
) VALUES
  (gen_random_uuid(), NULL, 'workshop_order.read', 'AUTO', '{"amount_max": null}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'workshop_order.add_line', 'AUTO', '{"amount_max": 500}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'inventory.part_reserve', 'AUTO', '{"amount_max": 250}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'document.sort', 'AUTO', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'sales_order.apply_discount', 'PROPOSE', '{"amount_max": 100}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'estimate.send_customer_message', 'PROPOSE', '{"customer_facing": true}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'import.apply', 'PROPOSE', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'invoice.finalize', 'HUMAN_ONLY', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'credit_note.issue', 'HUMAN_ONLY', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'tax_vat.update_wording', 'HUMAN_ONLY', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'accounting_export.create', 'HUMAN_ONLY', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'customer.delete', 'HUMAN_ONLY', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'tenant_member.role_change', 'HUMAN_ONLY', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'consent.update', 'HUMAN_ONLY', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
