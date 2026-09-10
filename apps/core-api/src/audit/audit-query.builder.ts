import { Prisma, type AuditLog } from '@prisma/client';
import { redactAuditSecrets } from './audit-redaction.util';
import type { AuditJsonValue } from './audit.types';
import type {
  QueryAuditLogsDto,
  AuditLogListResponseDto,
  AuditLogResponseDto,
} from './dto';

export interface AuditPaginationParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export const redactAuditResponseValue = (
  value: unknown,
  pathPrefix: string,
): { value: unknown; redactedPaths: string[] } => {
  if (value === null || value === undefined) {
    return { value: value ?? null, redactedPaths: [] };
  }

  const redacted = redactAuditSecrets(value as AuditJsonValue);
  return {
    value: redacted.value,
    redactedPaths: redacted.redactedPaths.map((path) =>
      pathPrefix ? `${pathPrefix}.${path}` : path,
    ),
  };
};

export function mapAuditLogRecordToDto(record: AuditLog): AuditLogResponseDto {
  const redactedBefore = redactAuditResponseValue(record.before, 'before');
  const redactedAfter = redactAuditResponseValue(record.after, 'after');
  const redactedDiff = redactAuditResponseValue(record.diff, 'diff');
  const redactedFields = Array.isArray(record.redacted_fields)
    ? (record.redacted_fields as string[])
    : [];

  return {
    id: record.id,
    tenantId: record.tenant_id,
    entityType: record.entity_type,
    entityId: record.entity_id,
    action: record.action,
    actorUserId: record.actor_user_id,
    actorEmail: record.actor_email,
    actorRole: record.actor_role,
    actorType: record.actor_type,
    requestId: record.request_id,
    source: record.source,
    ipAddress: record.ip_address,
    userAgent: record.user_agent,
    before: redactedBefore.value,
    after: redactedAfter.value,
    diff: redactedDiff.value,
    changedFields: Array.isArray(record.changed_fields)
      ? (record.changed_fields as string[])
      : null,
    redactedFields: [
      ...new Set([
        ...redactedFields,
        ...redactedBefore.redactedPaths,
        ...redactedAfter.redactedPaths,
        ...redactedDiff.redactedPaths,
      ]),
    ].sort(),
    occurredAt: record.occurred_at,
  };
}

export class AuditQueryBuilder {
  static readonly DEFAULT_PAGE = 1;
  static readonly DEFAULT_LIMIT = 20;
  static readonly DEFAULT_ORDER_BY: Prisma.AuditLogOrderByWithRelationInput = {
    occurred_at: 'desc',
  };

  static resolvePagination(
    page?: number,
    limit?: number,
  ): AuditPaginationParams {
    const resolvedPage = page && page > 0 ? page : this.DEFAULT_PAGE;
    const resolvedLimit = limit && limit > 0 ? limit : this.DEFAULT_LIMIT;
    const skip = (resolvedPage - 1) * resolvedLimit;

    return {
      page: resolvedPage,
      limit: resolvedLimit,
      skip,
      take: resolvedLimit,
    };
  }

  static buildWhere(
    tenantId: string,
    query: QueryAuditLogsDto,
  ): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {
      tenant_id: tenantId,
    };

    if (query.entityType) {
      where.entity_type = query.entityType;
    }

    if (query.entityId) {
      where.entity_id = query.entityId;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.actorUserId) {
      where.actor_user_id = query.actorUserId;
    }

    const dateFilter = this.buildDateFilter(query.startDate, query.endDate);
    if (dateFilter) {
      where.occurred_at = dateFilter;
    }

    const searchFilter = this.buildSearchFilter(query.search);
    if (searchFilter) {
      where.OR = searchFilter;
    }

    return where;
  }

  static computeWhere(
    tenantId: string,
    query: QueryAuditLogsDto,
  ): Prisma.AuditLogWhereInput {
    return this.buildWhere(tenantId, query);
  }

  static buildDateFilter(
    startDate?: string,
    endDate?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!startDate && !endDate) {
      return undefined;
    }

    const filter: Prisma.DateTimeFilter = {};
    if (startDate) {
      filter.gte = new Date(startDate);
    }
    if (endDate) {
      filter.lte = new Date(endDate);
    }
    return filter;
  }

  static buildSearchFilter(
    search?: string,
  ): Prisma.AuditLogWhereInput[] | undefined {
    if (!search || search.trim().length === 0) {
      return undefined;
    }

    const trimmed = search.trim();
    return [
      { entity_id: { contains: trimmed, mode: 'insensitive' } },
      { actor_email: { contains: trimmed, mode: 'insensitive' } },
      { request_id: { contains: trimmed, mode: 'insensitive' } },
    ];
  }

  static buildOrderBy(): Prisma.AuditLogOrderByWithRelationInput {
    return this.DEFAULT_ORDER_BY;
  }

  static mapRecordToDto(record: AuditLog): AuditLogResponseDto {
    return mapAuditLogRecordToDto(record);
  }

  static buildPaginatedResponse(
    records: AuditLog[],
    total: number,
    pagination: AuditPaginationParams,
  ): AuditLogListResponseDto {
    const totalPages = Math.ceil(total / pagination.limit) || 1;

    return {
      data: records.map((record) => this.mapRecordToDto(record)),
      meta: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages,
      },
    };
  }
}
