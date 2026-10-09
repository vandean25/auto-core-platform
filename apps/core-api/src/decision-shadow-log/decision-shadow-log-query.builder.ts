import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { parseInclusiveEndDate } from '../agent-action-log/agent-action-log-query.builder.js';
import type { QueryDecisionShadowLogsDto } from './dto/query-decision-shadow-logs.dto.js';

export type DecisionShadowLogCursor = {
  createdAt: string;
  id: string;
};

export function encodeDecisionShadowLogCursor(
  cursor: DecisionShadowLogCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeDecisionShadowLogCursor(
  cursor: string,
): DecisionShadowLogCursor | undefined {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as DecisionShadowLogCursor;
    if (
      typeof parsed?.createdAt !== 'string' ||
      typeof parsed?.id !== 'string' ||
      parsed.id.length === 0
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function buildDecisionShadowLogWhere(
  tenantId: string,
  query: QueryDecisionShadowLogsDto,
): Prisma.DecisionShadowLogWhereInput {
  const where: Prisma.DecisionShadowLogWhereInput = { tenant_id: tenantId };

  if (query.useCase) {
    where.use_case = query.useCase;
  }

  const createdAt = buildCreatedAtRange(query.startDate, query.endDate);
  if (createdAt) {
    where.created_at = createdAt;
  }

  if (query.cursor) {
    const decoded = decodeDecisionShadowLogCursor(query.cursor);
    if (!decoded) {
      throw new BadRequestException('cursor is invalid');
    }
    const cursorCreatedAt = new Date(decoded.createdAt);
    if (Number.isNaN(cursorCreatedAt.getTime())) {
      throw new BadRequestException('cursor is invalid');
    }
    where.OR = [
      { created_at: { lt: cursorCreatedAt } },
      { created_at: cursorCreatedAt, id: { lt: decoded.id } },
    ];
  }

  return where;
}

function buildCreatedAtRange(
  startDate: string | undefined,
  endDate: string | undefined,
): Prisma.DateTimeFilter | undefined {
  if (!startDate && !endDate) {
    return undefined;
  }

  const range: Prisma.DateTimeFilter = {};
  const start = startDate ? new Date(startDate) : undefined;
  if (start && Number.isNaN(start.getTime())) {
    throw new BadRequestException('startDate must be a valid ISO-8601 date');
  }
  const end = endDate ? parseInclusiveEndDate(endDate) : undefined;

  if (start && end && start.getTime() > end.getTime()) {
    throw new BadRequestException('startDate must be on or before endDate');
  }
  if (start) {
    range.gte = start;
  }
  if (end) {
    range.lte = end;
  }
  return range;
}
