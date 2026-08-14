import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { QueryAuditLogsDto, AuditLogListResponseDto, AuditLogResponseDto } from './dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findAll(query: QueryAuditLogsDto): Promise<AuditLogListResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

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

    if (query.startDate || query.endDate) {
      where.occurred_at = {};
      if (query.startDate) {
        where.occurred_at.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.occurred_at.lte = new Date(query.endDate);
      }
    }

    if (query.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      where.OR = [
        { entity_id: { contains: search, mode: 'insensitive' } },
        { actor_email: { contains: search, mode: 'insensitive' } },
        { request_id: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [records, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { occurred_at: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    const data: AuditLogResponseDto[] = records.map((record) => ({
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
      before: record.before ?? null,
      after: record.after ?? null,
      diff: record.diff ?? null,
      changedFields: Array.isArray(record.changed_fields)
        ? (record.changed_fields as string[])
        : null,
      redactedFields: Array.isArray(record.redacted_fields)
        ? (record.redacted_fields as string[])
        : null,
      occurredAt: record.occurred_at,
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }
}
