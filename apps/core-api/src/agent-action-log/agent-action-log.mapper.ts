import type { AgentActionLog } from '@prisma/client';
import type { AgentActionLogResponseDto } from './dto/agent-action-log-response.dto.js';

export function mapAgentActionLog(
  record: AgentActionLog,
): AgentActionLogResponseDto {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    traceId: record.trace_id,
    parentTraceId: record.parent_trace_id,
    actorType: record.actor_type,
    agentId: record.agent_id,
    onBehalfOfUserId: record.on_behalf_of_user_id,
    actionType: record.action_type,
    tier: record.tier,
    status: record.status,
    inputSummary: record.input_summary_json,
    resultSummary: record.result_summary_json,
    entityType: record.entity_type,
    entityId: record.entity_id,
    reversible: record.reversible,
    revertedByLogId: record.reverted_by_log_id,
    createdAt: record.created_at,
  };
}
