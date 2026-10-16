-- AUT-538: idempotent mechanic finding submits (command_id as trace_id).
-- Partial unique: other action types may share one trace_id across multiple proposals.
CREATE UNIQUE INDEX "agent_proposals_mechanic_finding_command_idempotency_key"
ON "agent_proposals"("tenant_id", "trace_id")
WHERE "action_type" = 'workshop_order.mechanic_finding';
