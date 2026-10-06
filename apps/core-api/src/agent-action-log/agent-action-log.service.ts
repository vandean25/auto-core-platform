import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditQueryBuilder } from '../audit/audit-query.builder.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runWithAgentAuditTrace } from './agent-action-log-audit.context.js';
import {
  buildAgentActionWhere,
  encodeAgentActionCursor,
} from './agent-action-log-query.builder.js';
import { mapAgentActionLog } from './agent-action-log.mapper.js';
import {
  agentActionRecordInputSchema,
  type AgentActionRecordInput,
} from './agent-action-log.types.js';
import { redactAgentActionSummary } from './agent-action-summary.util.js';
import { isTraceIdUuid } from '../common/services/trace-id.util.js';
import type {
  AgentActionLogListResponseDto,
  AgentActionTraceDetailResponseDto,
} from './dto/index.js';
import type { QueryAgentActionsDto } from './dto/query-agent-actions.dto.js';

export type AgentActionRecordResult<T> = {
  id: string;
  traceId: string;
  workResult?: T;
};

@Injectable()
export class AgentActionLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly requestContext: RequestContextService,
  ) {}

  async record<T>(
    input: AgentActionRecordInput,
    work?: () => Promise<T>,
    metadataFromResult?: (
      result: T | undefined,
    ) => Partial<AgentActionRecordInput>,
  ): Promise<AgentActionRecordResult<T>> {
    const parsed = agentActionRecordInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    const traceId = parsed.traceId ?? this.requireTraceId();

    let workResult: T | undefined;
    let workError: unknown;

    if (work) {
      try {
        workResult = await runWithAgentAuditTrace(traceId, work);
      } catch (error) {
        workError = error;
      }
    }

    const status = workError ? 'FAILED' : parsed.status;
    const failureMessage = workError
      ? workError instanceof Error
        ? workError.message
        : typeof workError === 'string'
          ? workError
          : 'Agent action work failed'
      : undefined;
    const resolvedResultSummary =
      typeof parsed.resultSummary === 'function'
        ? (parsed.resultSummary as (result: T | undefined) => unknown)(
            workResult,
          )
        : parsed.resultSummary;
    const resultForSummary = failureMessage
      ? { error: failureMessage }
      : resolvedResultSummary;
    const resultMetadata = workError
      ? {}
      : (metadataFromResult?.(workResult) ?? {});

    const created = await this.prisma.agentActionLog.create({
      data: {
        tenant_id: tenantId,
        trace_id: traceId,
        parent_trace_id: parsed.parentTraceId ?? null,
        actor_type: parsed.actorType,
        agent_id: parsed.agentId ?? null,
        on_behalf_of_user_id: parsed.onBehalfOfUserId ?? null,
        action_type: parsed.actionType,
        tier: parsed.tier,
        status,
        input_summary_json: redactAgentActionSummary(
          parsed.inputSummary,
        ) as Prisma.InputJsonValue,
        result_summary_json: redactAgentActionSummary(
          resultForSummary,
        ) as Prisma.InputJsonValue,
        entity_type: resultMetadata.entityType ?? parsed.entityType ?? null,
        entity_id: resultMetadata.entityId ?? parsed.entityId ?? null,
        reversible: resultMetadata.reversible ?? parsed.reversible ?? false,
        reverted_by_log_id: parsed.revertedByLogId ?? null,
      },
    });

    if (workError) {
      if (workError instanceof Error) {
        throw workError;
      }
      throw new Error(failureMessage ?? 'Agent action work failed');
    }

    return { id: created.id, traceId, workResult };
  }

  async recordInTransaction<T = never>(
    input: AgentActionRecordInput,
    transaction: Prisma.TransactionClient,
    work?: () => Promise<T>,
  ): Promise<AgentActionRecordResult<T>> {
    const parsed = agentActionRecordInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    const traceId = parsed.traceId ?? this.requireTraceId();
    const workResult = work
      ? await runWithAgentAuditTrace(traceId, work)
      : undefined;
    const resultSummary =
      typeof parsed.resultSummary === 'function'
        ? (parsed.resultSummary as (result: T | undefined) => unknown)(
            workResult,
          )
        : parsed.resultSummary;

    const created = await transaction.agentActionLog.create({
      data: {
        tenant_id: tenantId,
        trace_id: traceId,
        parent_trace_id: parsed.parentTraceId ?? null,
        actor_type: parsed.actorType,
        agent_id: parsed.agentId ?? null,
        on_behalf_of_user_id: parsed.onBehalfOfUserId ?? null,
        action_type: parsed.actionType,
        tier: parsed.tier,
        status: parsed.status,
        input_summary_json: redactAgentActionSummary(
          parsed.inputSummary,
        ) as Prisma.InputJsonValue,
        result_summary_json: redactAgentActionSummary(
          resultSummary,
        ) as Prisma.InputJsonValue,
        entity_type: parsed.entityType ?? null,
        entity_id: parsed.entityId ?? null,
        reversible: parsed.reversible ?? false,
        reverted_by_log_id: parsed.revertedByLogId ?? null,
      },
    });

    return { id: created.id, traceId, workResult };
  }

  async findAll(
    query: QueryAgentActionsDto,
  ): Promise<AgentActionLogListResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const limit = query.limit ?? 20;
    const where = buildAgentActionWhere(tenantId, query);

    const records = await this.prisma.agentActionLog.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    const last = page.at(-1);

    return {
      data: page.map(mapAgentActionLog),
      nextCursor:
        hasMore && last
          ? encodeAgentActionCursor({
              createdAt: last.created_at.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async findByTraceId(
    traceId: string,
  ): Promise<AgentActionTraceDetailResponseDto> {
    if (!isTraceIdUuid(traceId)) {
      throw new BadRequestException('traceId must be a UUID');
    }

    const tenantId = await this.tenantContext.getTenantId();
    const logs = await this.prisma.agentActionLog.findMany({
      where: { tenant_id: tenantId, trace_id: traceId },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });

    if (logs.length === 0) {
      throw new NotFoundException(
        `No agent action log entries found for trace ${traceId}`,
      );
    }

    const auditRecords = await this.prisma.auditLog.findMany({
      where: { tenant_id: tenantId, request_id: traceId },
      orderBy: { occurred_at: 'asc' },
    });

    return {
      logs: logs.map(mapAgentActionLog),
      auditEntries: auditRecords.map((record) =>
        AuditQueryBuilder.mapRecordToDto(record),
      ),
    };
  }

  private requireTraceId(): string {
    const traceId = this.requestContext.getTraceId();
    if (!traceId) {
      throw new BadRequestException(
        'traceId is required when no request trace context is available',
      );
    }
    return traceId;
  }
}
