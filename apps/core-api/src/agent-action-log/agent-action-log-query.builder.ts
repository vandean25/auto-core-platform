import type { Prisma } from '@prisma/client';
import type { QueryAgentActionsDto } from './dto/query-agent-actions.dto.js';

export type AgentActionCursor = {
  createdAt: string;
  id: string;
};

export function encodeAgentActionCursor(cursor: AgentActionCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeAgentActionCursor(
  cursor: string,
): AgentActionCursor | undefined {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as AgentActionCursor;
    if (!parsed?.createdAt || !parsed?.id) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function buildAgentActionWhere(
  tenantId: string,
  query: QueryAgentActionsDto,
): Prisma.AgentActionLogWhereInput {
  const where: Prisma.AgentActionLogWhereInput = { tenant_id: tenantId };

  if (query.traceId) {
    where.trace_id = query.traceId;
  }
  if (query.agentId) {
    where.agent_id = query.agentId;
  }
  if (query.status) {
    where.status = query.status;
  }
  if (query.tier) {
    where.tier = query.tier;
  }
  if (query.entityType) {
    where.entity_type = query.entityType;
  }
  if (query.entityId) {
    where.entity_id = query.entityId;
  }
  if (query.startDate || query.endDate) {
    where.created_at = {};
    if (query.startDate) {
      where.created_at.gte = new Date(query.startDate);
    }
    if (query.endDate) {
      where.created_at.lte = new Date(query.endDate);
    }
  }

  const decoded = query.cursor
    ? decodeAgentActionCursor(query.cursor)
    : undefined;
  if (decoded) {
    const createdAt = new Date(decoded.createdAt);
    where.OR = [
      { created_at: { lt: createdAt } },
      {
        created_at: createdAt,
        id: { lt: decoded.id },
      },
    ];
  }

  return where;
}
