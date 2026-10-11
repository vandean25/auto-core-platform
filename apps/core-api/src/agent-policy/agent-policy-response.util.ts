import { AuditLogAction } from '@prisma/client';
import type { AgentPolicyTier } from '@prisma/client';
import type { RecordTenantAuditParams } from '../audit/audit.service.js';
import {
  AGENT_POLICY_AUDIT_SOURCE,
  AGENT_POLICY_ENTITY_TYPE,
} from './agent-policy.constants.js';
import type { AgentPolicyRuleResponseDto } from './dto/agent-policy.dto.js';
import type {
  AgentPolicyConditions,
  ResolvedAgentPolicyRule,
} from './agent-policy.types.js';

/** The rule as recorded in an audit entry's before/after. */
export type AgentPolicyAuditSnapshot = {
  action_type: string;
  tier: AgentPolicyTier;
  conditions: AgentPolicyConditions;
  enabled: boolean;
  version: number;
  source: ResolvedAgentPolicyRule['source'];
};

export function toAgentPolicyRuleResponseDto(
  rule: ResolvedAgentPolicyRule,
): AgentPolicyRuleResponseDto {
  return {
    id: rule.id,
    action_type: rule.action_type,
    tier: rule.tier,
    conditions: rule.conditions,
    enabled: rule.enabled,
    version: rule.version,
    source: rule.source,
    created_at: rule.created_at.toISOString(),
    updated_at: rule.updated_at.toISOString(),
  };
}

export function toAuditSnapshot(
  rule: ResolvedAgentPolicyRule,
): AgentPolicyAuditSnapshot {
  return {
    action_type: rule.action_type,
    tier: rule.tier,
    conditions: rule.conditions,
    enabled: rule.enabled,
    version: rule.version,
    source: rule.source,
  };
}

export function buildAgentPolicyUpdateAudit(params: {
  entityId: string;
  actorUserId: string;
  before: AgentPolicyAuditSnapshot;
  after: AgentPolicyAuditSnapshot;
}): RecordTenantAuditParams {
  const { before, after } = params;
  return {
    entityType: AGENT_POLICY_ENTITY_TYPE,
    entityId: params.entityId,
    action: AuditLogAction.UPDATE,
    actorUserId: params.actorUserId,
    source: AGENT_POLICY_AUDIT_SOURCE,
    before,
    after,
    diff: {
      tier: { before: before.tier, after: after.tier },
      version: { before: before.version, after: after.version },
    },
  };
}
