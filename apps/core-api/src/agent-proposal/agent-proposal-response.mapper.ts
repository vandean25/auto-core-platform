import type { AgentProposal } from '@prisma/client';
import type { TenantUserContact } from '../common/services/tenant-user-contact.util.js';
import {
  resolveWorkshopOrderId,
  WORKSHOP_ORDER_ID_KEYS,
  isWorkshopOrderLineAction,
} from './agent-proposal-payload.js';
import { extractPolicyContext } from './agent-proposal-policy-context.js';
import type {
  AgentProposalResponseDto,
  AgentProposalWorkshopOrderSummaryDto,
} from './dto/agent-proposal.dto.js';

export function toAgentProposalResponseDto(
  proposal: AgentProposal,
  workshopOrderSummaries: Map<
    string,
    AgentProposalWorkshopOrderSummaryDto
  > = new Map(),
  deciders: Map<string, TenantUserContact> = new Map(),
): AgentProposalResponseDto {
  const payload = (proposal.payload_json ?? {}) as Record<string, unknown>;
  const decider = resolveDeciderFields(proposal.decided_by, deciders);
  return {
    id: proposal.id,
    tenant_id: proposal.tenant_id,
    trace_id: proposal.trace_id,
    action_type: proposal.action_type,
    tier: proposal.tier,
    status: proposal.status,
    payload_json: payload,
    effective_summary: buildEffectiveSummary(proposal.action_type, payload),
    workshop_order_summary: resolveWorkshopOrderSummary(
      resolveWorkshopOrderId(proposal.action_type, payload),
      workshopOrderSummaries,
    ),
    preview_json: (proposal.preview_json ?? null) as Record<
      string,
      unknown
    > | null,
    created_by_agent: proposal.created_by_agent,
    decided_by: proposal.decided_by,
    decided_by_name: decider.decided_by_name,
    decided_by_email: decider.decided_by_email,
    decided_at: toIsoStringOrNull(proposal.decided_at),
    reason: proposal.reason,
    expires_at: proposal.expires_at.toISOString(),
    created_at: proposal.createdAt.toISOString(),
    updated_at: proposal.updatedAt.toISOString(),
  };
}

export function buildEffectiveSummary(
  actionType: string,
  payload: Record<string, unknown>,
): {
  target_type: string | null;
  target_id: string | null;
  amount_eur: number | null;
} {
  return {
    target_type: resolveTargetType(actionType, payload),
    target_id: resolveTargetId(actionType, payload),
    amount_eur: resolveAmountEur(actionType, payload),
  };
}

function resolveDeciderFields(
  decidedBy: string | null,
  deciders: Map<string, TenantUserContact>,
): { decided_by_name: string | null; decided_by_email: string | null } {
  const decider = decidedBy ? deciders.get(decidedBy) : undefined;
  return {
    decided_by_name: decider?.name ?? null,
    decided_by_email: decider?.email ?? null,
  };
}

function resolveWorkshopOrderSummary(
  workshopOrderId: string | null,
  summaries: Map<string, AgentProposalWorkshopOrderSummaryDto>,
): AgentProposalWorkshopOrderSummaryDto | null {
  return workshopOrderId ? (summaries.get(workshopOrderId) ?? null) : null;
}

function toIsoStringOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function resolveTargetType(
  actionType: string,
  payload: Record<string, unknown>,
): string | null {
  if (actionType === 'customer.update') {
    return 'Customer';
  }
  if (isWorkshopOrderLineAction(actionType)) {
    return 'WorkshopOrder';
  }
  return firstString(payload, ['entity_type', 'entityType']);
}

function resolveTargetId(
  actionType: string,
  payload: Record<string, unknown>,
): string | null {
  if (actionType === 'customer.update') {
    return firstString(payload, ['customer_id', 'customerId']);
  }
  if (isWorkshopOrderLineAction(actionType)) {
    return firstString(payload, [...WORKSHOP_ORDER_ID_KEYS]);
  }
  return firstString(payload, ['entity_id', 'entityId']);
}

function resolveAmountEur(
  actionType: string,
  payload: Record<string, unknown>,
): number | null {
  try {
    const amount = extractPolicyContext(payload, actionType).amount_eur;
    return typeof amount === 'number' ? amount : null;
  } catch {
    return null;
  }
}

function firstString(
  payload: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string') return value;
  }
  return null;
}
