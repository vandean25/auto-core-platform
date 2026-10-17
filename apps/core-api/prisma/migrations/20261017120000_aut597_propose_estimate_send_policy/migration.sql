-- AUT-597: MCP propose_estimate_send uses estimate.send_customer_message for policy
-- evaluation (default off) and workshop_estimate.send for pending-action apply.

UPDATE "agent_policy_rules"
SET
  "enabled" = false,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "tenant_id" IS NULL
  AND "action_type" = 'estimate.send_customer_message';

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
  'workshop_estimate.send',
  'PROPOSE',
  '{"customer_facing": true}',
  false,
  1,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
