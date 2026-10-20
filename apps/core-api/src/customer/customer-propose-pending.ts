import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import type { McpWriteToolResult } from '../mcp/mcp-write-pipeline.types.js';
import { MCP_AGENT_FACING_CODES } from '../mcp/mcp.constants.js';
import type { McpWriteToolName } from '../mcp/mcp.constants.js';
import { readCustomerProposalFields } from '../mcp/mcp-write-customer-result.js';

const CUSTOMER_PROPOSAL_ACTION_TYPES = new Set([
  'customer.create',
  'customer.update',
]);

/** Class id for customer proposal idempotency advisory locks (AUT-613). */
const CUSTOMER_PROPOSAL_ADVISORY_LOCK_CLASS = 0x0a_06_13;

export function isCustomerProposalActionType(actionType: string): boolean {
  return CUSTOMER_PROPOSAL_ACTION_TYPES.has(actionType);
}

export function idempotencyKeyFromProposalPayload(
  payload: unknown,
): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const key = (payload as Record<string, unknown>).idempotency_key;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

export function customerProposalAdvisoryLockKeys(
  tenantId: string,
  actionType: string,
  idempotencyKey: string,
): [number, number] {
  const digest = createHash('sha256')
    .update(
      `core-api:customer-proposal:${tenantId}:${actionType}:${idempotencyKey}`,
      'utf8',
    )
    .digest();
  return [CUSTOMER_PROPOSAL_ADVISORY_LOCK_CLASS, digest.readInt32BE(0)];
}

type Tx = Prisma.TransactionClient;

/**
 * Serializes parallel first calls for the same idempotency key without a DB
 * migration: `pg_advisory_xact_lock` for the tenant, action, and key, then a
 * second read before insert.
 */
export async function lockCustomerProposalIdempotency(
  tx: Tx,
  tenantId: string,
  actionType: string,
  idempotencyKey: string,
): Promise<void> {
  const [key1, key2] = customerProposalAdvisoryLockKeys(
    tenantId,
    actionType,
    idempotencyKey,
  );
  // eslint-disable-next-line no-restricted-syntax -- AUT-613: serialize idempotent proposal creates without a unique index.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int, ${key2}::int)`;
}

export async function findPendingCustomerProposal(
  prisma: PrismaService | Tx,
  tenantId: string,
  actionType: string,
  idempotencyKey: string,
) {
  return prisma.agentProposal.findFirst({
    where: {
      tenant_id: tenantId,
      action_type: actionType,
      status: 'PENDING',
      payload_json: { path: ['idempotency_key'], equals: idempotencyKey },
    },
  });
}

export function replayPendingCustomerProposalResult(input: {
  tool: McpWriteToolName;
  tier: McpWriteToolResult['tier'];
  pendingActionId: string;
  previewJson: unknown;
  traceId?: string | null;
}): McpWriteToolResult {
  const previewRecord =
    input.previewJson && typeof input.previewJson === 'object'
      ? (input.previewJson as Record<string, unknown>)
      : {};
  const proposal = previewRecord.proposal ?? previewRecord;
  const customerFields = readCustomerProposalFields(
    previewRecord.preview ?? previewRecord,
  );
  const result: McpWriteToolResult = {
    tool: input.tool,
    tier: input.tier,
    status: MCP_AGENT_FACING_CODES.needsApprovalStatus,
    would_change: readWouldChange(previewRecord.would_change),
    proposal,
    pending_action_id: input.pendingActionId,
    trace_id: input.traceId ?? undefined,
    replayed: true,
  };
  return { ...result, ...customerFields };
}

function readWouldChange(value: unknown): WouldChangeItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as WouldChangeItem[];
}
