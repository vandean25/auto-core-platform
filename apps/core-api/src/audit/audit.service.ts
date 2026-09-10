import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { QueryAuditLogsDto, AuditLogListResponseDto } from './dto';
import { AuditQueryBuilder } from './audit-query.builder';

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
}
