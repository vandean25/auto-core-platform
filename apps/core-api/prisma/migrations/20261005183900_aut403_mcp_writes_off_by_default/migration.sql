-- Disable MCP write actions by default while preserving their platform tier floor.
INSERT INTO "agent_policy_rules" (
  "id", "tenant_id", "action_type", "tier", "conditions_json", "enabled", "version", "created_by", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  NULL,
  platform_rule."action_type",
  platform_rule."tier",
  platform_rule."conditions_json",
  false,
  platform_rule."version" + 1,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "agent_policy_rules" AS platform_rule
WHERE platform_rule."tenant_id" IS NULL
  AND platform_rule."enabled" = true
  AND platform_rule."action_type" IN (
    'workshop_order.create',
    'inventory.part_reserve',
    'inventory.part_release',
    'workshop_order.propose_line'
  )
  AND platform_rule."version" = (
    SELECT MAX(latest."version")
    FROM "agent_policy_rules" AS latest
    WHERE latest."tenant_id" IS NULL
      AND latest."action_type" = platform_rule."action_type"
  );

-- A disabled platform rule is still the tier and condition floor for tenant overrides.
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

  IF platform_row.id IS NULL THEN
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
