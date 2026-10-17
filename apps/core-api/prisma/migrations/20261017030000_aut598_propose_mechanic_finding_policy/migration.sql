INSERT INTO "agent_policy_rules" (
  "id",
  "tenant_id",
  "action_type",
  "tier",
  "conditions_json",
  "enabled",
  "version",
  "created_by",
  "created_at",
  "updated_at"
)
VALUES (
  gen_random_uuid(),
  NULL,
  'workshop_order.propose_mechanic_finding',
  'PROPOSE',
  '{}',
  false,
  1,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
