-- AUT-597: MCP propose_estimate_send evaluates estimate.send_customer_message
-- (propose and human apply). Default off at platform.

UPDATE "agent_policy_rules"
SET
  "enabled" = false,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "tenant_id" IS NULL
  AND "action_type" = 'estimate.send_customer_message';
