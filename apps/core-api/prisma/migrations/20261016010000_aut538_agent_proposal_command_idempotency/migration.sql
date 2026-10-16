-- AUT-538: one pending mechanic finding per tenant + trace (command_id) + action type.
CREATE UNIQUE INDEX "agent_proposals_tenant_id_trace_id_action_type_key"
ON "agent_proposals"("tenant_id", "trace_id", "action_type");
