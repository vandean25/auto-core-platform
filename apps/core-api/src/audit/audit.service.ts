import { Injectable } from '@nestjs/common';
import { AuditActorType, AuditLogAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { QueryAuditLogsDto, AuditLogListResponseDto } from './dto/index.js';
import { AuditQueryBuilder } from './audit-query.builder.js';

export type RecordTenantAuditParams = {
  entityType: string;
  entityId: string;
  action: AuditLogAction;
  actorUserId?: string | null;
  /** USER unless the write is made by the system, such as a public estimate decision. */
  actorType?: AuditActorType;
  source?: string | null;
  before?: unknown;
  after?: unknown;
  diff?: unknown;
};

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findAll(query: QueryAuditLogsDto): Promise<AuditLogListResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const pagination = AuditQueryBuilder.resolvePagination(
      query.page,
      query.limit,
    );
    const where = AuditQueryBuilder.buildWhere(tenantId, query);
    const orderBy = AuditQueryBuilder.buildOrderBy();

    const [records, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return AuditQueryBuilder.buildPaginatedResponse(records, total, pagination);
  }

  async recordTenantMutation(
    params: RecordTenantAuditParams,
    client: Pick<PrismaService, 'auditLog'> = this.prisma,
  ): Promise<void> {
    const tenantId = await this.tenantContext.getTenantId();
    const authUser = this.tenantContext.getAuthenticatedUser();

    await client.auditLog.create({
      data: {
        tenant_id: tenantId,
        entity_type: params.entityType,
        entity_id: params.entityId,
        action: params.action,
        actor_user_id: params.actorUserId ?? null,
        actor_email: authUser?.email ?? null,
        actor_role: authUser?.role ?? null,
        actor_type: params.actorType ?? AuditActorType.USER,
        request_id: correlationId(TenantContextStorage.getRequestMeta()),
        source: params.source ?? null,
        before: jsonOrNull(params.before),
        after: jsonOrNull(params.after),
        diff: jsonOrNull(params.diff),
      },
    });
  }
}

/** A JSON column value, or Prisma's JsonNull when the value is absent. */
function jsonOrNull(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value ? value : Prisma.JsonNull;
}

/**
 * Same correlation rule as the Prisma audit extension: the agent trace when inside an agent action, otherwise the
 * request ID.
 */
function correlationId(
  requestMeta: ReturnType<typeof TenantContextStorage.getRequestMeta>,
): string | null {
  return requestMeta?.auditCorrelationId ?? requestMeta?.requestId ?? null;
}
