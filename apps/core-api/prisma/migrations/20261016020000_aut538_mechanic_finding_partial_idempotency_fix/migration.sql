-- Replace global unique (if applied from an earlier revision of AUT-538) with partial index.
DROP INDEX IF EXISTS "agent_proposals_tenant_id_trace_id_action_type_key";

CREATE UNIQUE INDEX IF NOT EXISTS "agent_proposals_mechanic_finding_command_idempotency_key"
ON "agent_proposals"("tenant_id", "trace_id")
WHERE "action_type" = 'workshop_order.mechanic_finding';
