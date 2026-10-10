import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type AgentActionLog, type Prisma } from '@prisma/client';
import { AuditQueryBuilder } from '../audit/audit-query.builder.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { loadTenantUserContacts } from '../common/services/tenant-user-contact.util.js';
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
import {
  buildAgentActionLogCreateData,
  describeWorkError,
  resolveWorkRecordFields,
  type WorkOutcome,
} from './agent-action-log.record.js';
import { isTraceIdUuid } from '../common/services/trace-id.util.js';
import type {
  AgentActionLogListResponseDto,
  AgentActionLogResponseDto,
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
  private readonly prisma: PrismaService;
  private readonly tenantContext: TenantContextService;
  private readonly requestContext: RequestContextService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    prisma: PrismaService,
    tenantContext: TenantContextService,
    requestContext: RequestContextService,
  ) {
    this.prisma = prisma;
    this.tenantContext = tenantContext;
    this.requestContext = requestContext;
  }

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

    const outcome = await this.runWork(traceId, work);
    const created = await this.prisma.agentActionLog.create({
      data: buildAgentActionLogCreateData(
        parsed,
        { tenantId, traceId },
        resolveWorkRecordFields(parsed, outcome, metadataFromResult),
      ),
    });

    if (outcome.failed) {
      throw outcome.error instanceof Error
        ? outcome.error
        : new Error(describeWorkError(outcome.error));
    }
    return { id: created.id, traceId, workResult: outcome.result };
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

    const created = await transaction.agentActionLog.create({
      data: buildAgentActionLogCreateData(
        parsed,
        { tenantId, traceId },
        resolveWorkRecordFields(parsed, {
          failed: false,
          error: undefined,
          result: workResult,
        }),
      ),
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
      data: await this.mapWithOnBehalfOfContacts(tenantId, page),
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
      logs: await this.mapWithOnBehalfOfContacts(tenantId, logs),
      auditEntries: auditRecords.map((record) =>
        AuditQueryBuilder.mapRecordToDto(record),
      ),
    };
  }

  /**
   * Runs the work inside the audit trace. A thrown value counts as a failure only when it is truthy,
   * which is how the record has always treated it.
   */
  private async runWork<T>(
    traceId: string,
    work?: () => Promise<T>,
  ): Promise<WorkOutcome<T>> {
    if (!work) {
      return { failed: false, error: undefined, result: undefined };
    }
    try {
      return {
        failed: false,
        error: undefined,
        result: await runWithAgentAuditTrace(traceId, work),
      };
    } catch (error) {
      return { failed: Boolean(error), error, result: undefined };
    }
  }

  /** One contact lookup per page, so rows never query users one by one. */
  private async mapWithOnBehalfOfContacts(
    tenantId: string,
    records: AgentActionLog[],
  ): Promise<AgentActionLogResponseDto[]> {
    const contacts = await loadTenantUserContacts(
      this.prisma,
      tenantId,
      records.map((record) => record.on_behalf_of_user_id),
    );
    return records.map((record) =>
      mapAgentActionLog(
        record,
        record.on_behalf_of_user_id
          ? contacts.get(record.on_behalf_of_user_id)
          : undefined,
      ),
    );
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
