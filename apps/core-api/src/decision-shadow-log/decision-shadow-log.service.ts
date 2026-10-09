import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildDecisionShadowLogWhere,
  encodeDecisionShadowLogCursor,
} from './decision-shadow-log-query.builder.js';
import { mapDecisionShadowLog } from './decision-shadow-log.mapper.js';
import { DECISION_SHADOW_LOG_SELECT } from './decision-shadow-log.types.js';
import type {
  DecisionShadowLogListResponseDto,
  QueryDecisionShadowLogsDto,
} from './dto/index.js';

const DEFAULT_LIMIT = 20;

@Injectable()
export class DecisionShadowLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Read-only. Shadow rows are never applied or mutated through this API. */
  async findAll(
    query: QueryDecisionShadowLogsDto,
  ): Promise<DecisionShadowLogListResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const limit = query.limit ?? DEFAULT_LIMIT;

    const records = await this.prisma.decisionShadowLog.findMany({
      where: buildDecisionShadowLogWhere(tenantId, query),
      select: DECISION_SHADOW_LOG_SELECT,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    const last = page.at(-1);

    return {
      data: page.map(mapDecisionShadowLog),
      nextCursor:
        hasMore && last
          ? encodeDecisionShadowLogCursor({
              createdAt: last.created_at.toISOString(),
              id: last.id,
            })
          : null,
    };
  }
}
