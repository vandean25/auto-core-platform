INSERT INTO "agent_policy_rules" (
  "id",
  "tenant_id",
  "action_type",
  "tier",
  "conditions",
  "enabled",
  "version",
  "created_by_user_id",
  "createdAt",
  "updatedAt"
)
VALUES (
  gen_random_uuid(),
  NULL,
  'registration_intake.apply',
  'PROPOSE',
  '{}',
  false,
  1,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
