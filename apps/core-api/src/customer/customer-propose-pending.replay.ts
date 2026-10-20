import type { Prisma } from '@prisma/client';
import type { McpWriteToolName } from '../mcp/mcp.constants.js';
import type { McpWriteToolResult } from '../mcp/mcp-write-pipeline.types.js';
import {
  findPendingCustomerProposal,
  idempotencyKeyFromProposalPayload,
  isCustomerProposalActionType,
  lockCustomerProposalIdempotency,
  replayPendingCustomerProposalResult,
} from './customer-propose-pending.js';

type Tx = Prisma.TransactionClient;

/**
 * When a customer proposal reuses an idempotency key, returns the existing
 * pending action instead of creating a second row. Uses `pg_advisory_xact_lock`
 * so parallel first calls serialize without a unique DB constraint.
 */
export async function replayCustomerProposalIfPending(
  tx: Tx,
  input: {
    tenantId: string;
    proposalActionType: string;
    proposalPayload: unknown;
    tool: McpWriteToolName;
    tier: McpWriteToolResult['tier'];
  },
): Promise<McpWriteToolResult | null> {
  if (!isCustomerProposalActionType(input.proposalActionType)) {
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
  const existing = await findPendingCustomerProposal(
    tx,
    input.tenantId,
    input.proposalActionType,
    idempotencyKey,
  );
  if (!existing) {
    return null;
  }
  return replayPendingCustomerProposalResult({
    tool: input.tool,
    tier: input.tier,
    pendingActionId: existing.id,
    previewJson: existing.preview_json,
    traceId: existing.trace_id,
  });
}
