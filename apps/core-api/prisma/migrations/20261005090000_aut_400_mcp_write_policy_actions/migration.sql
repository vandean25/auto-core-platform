-- Platform default policy rows for the AUT-400 phase 2 MCP write tools.
-- Expand-only: only new platform rows are inserted; existing rows are untouched.

INSERT INTO "agent_policy_rules" (
  "id", "tenant_id", "action_type", "tier", "conditions_json", "enabled", "version", "created_by", "created_at", "updated_at"
) VALUES
  (gen_random_uuid(), NULL, 'workshop_order.create', 'AUTO', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'inventory.part_release', 'AUTO', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), NULL, 'workshop_order.propose_line', 'PROPOSE', '{}', true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
