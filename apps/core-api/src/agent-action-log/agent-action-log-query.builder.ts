import { BadRequestException } from '@nestjs/common';
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

export function parseInclusiveEndDate(endDate: string): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (dateOnly.test(endDate)) {
    return new Date(`${endDate}T23:59:59.999Z`);
  }

  const parsed = new Date(endDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('endDate must be a valid ISO-8601 date');
  }
  return parsed;
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
      const start = new Date(query.startDate);
      if (Number.isNaN(start.getTime())) {
        throw new BadRequestException('startDate must be a valid ISO-8601 date');
      }
      where.created_at.gte = start;
    }
    if (query.endDate) {
      where.created_at.lte = parseInclusiveEndDate(query.endDate);
    }
  }

  if (query.cursor) {
    const decoded = decodeAgentActionCursor(query.cursor);
    if (!decoded) {
      throw new BadRequestException('cursor is invalid');
    }
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new BadRequestException('cursor is invalid');
    }
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
