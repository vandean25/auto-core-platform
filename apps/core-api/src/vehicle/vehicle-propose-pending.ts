import type { Prisma } from '@prisma/client';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import type { McpWriteToolResult } from '../mcp/mcp-write-pipeline.types.js';
import { MCP_AGENT_FACING_CODES } from '../mcp/mcp.constants.js';
import type { McpWriteToolName } from '../mcp/mcp.constants.js';
import { readVehicleProposalFields } from '../mcp/mcp-write-vehicle-result.js';
import {
  idempotencyKeyFromProposalPayload,
  lockCustomerProposalIdempotency,
} from '../customer/customer-propose-pending.js';

const VEHICLE_PROPOSAL_ACTION_TYPES = new Set([
  'vehicle.create',
  'vehicle.update',
]);

type Tx = Prisma.TransactionClient;

export function isVehicleProposalActionType(actionType: string): boolean {
  return VEHICLE_PROPOSAL_ACTION_TYPES.has(actionType);
}

export async function replayVehicleProposalIfPending(
  tx: Tx,
  input: {
    tenantId: string;
    proposalActionType: string;
    proposalPayload: unknown;
    tool: McpWriteToolName;
    tier: McpWriteToolResult['tier'];
  },
): Promise<McpWriteToolResult | null> {
  if (!isVehicleProposalActionType(input.proposalActionType)) {
    return null;
  }
  const idempotencyKey = idempotencyKeyFromProposalPayload(
    input.proposalPayload,
  );
  if (!idempotencyKey) {
    return null;
  }
  await lockCustomerProposalIdempotency(
    tx,
    input.tenantId,
    input.proposalActionType,
    idempotencyKey,
  );

  const existing = await tx.agentProposal.findFirst({
    where: {
      tenant_id: input.tenantId,
      action_type: input.proposalActionType,
      status: 'PENDING',
      payload_json: { path: ['idempotency_key'], equals: idempotencyKey },
    },
  });
  if (!existing) {
    return null;
  }

  const previewRecord =
    existing.preview_json && typeof existing.preview_json === 'object'
      ? (existing.preview_json as Record<string, unknown>)
      : {};
  const proposal = previewRecord.proposal ?? previewRecord;
  const vehicleFields = readVehicleProposalFields(
    previewRecord.preview ?? previewRecord,
  );
  const wouldChange = Array.isArray(previewRecord.would_change)
    ? (previewRecord.would_change as WouldChangeItem[])
    : [];

  return {
    tool: input.tool,
    tier: input.tier,
    status: MCP_AGENT_FACING_CODES.needsApprovalStatus,
    would_change: wouldChange,
    proposal,
    pending_action_id: existing.id,
    trace_id: existing.trace_id ?? undefined,
    replayed: true,
    ...vehicleFields,
  };
}
