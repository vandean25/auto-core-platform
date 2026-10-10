import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { buildAgentActionWhere } from '../agent-action-log/agent-action-log-query.builder.js';
import { AuditQueryBuilder } from '../audit/audit-query.builder.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MCP_DEFAULT_PAGE_SIZE, MCP_MAX_PAGE_SIZE } from './mcp.constants.js';
import { isMcpSupervisorRole } from './mcp.authorization.js';
import {
  decodeMcpKeysetCursor,
  normalizeMcpRangeEnd,
  normalizeMcpRangeStart,
  type McpKeysetCursor,
} from './mcp-output.util.js';
import {
  buildMcpKeysetPage,
  keysetCursorOf,
  toMcpAgentActionDetailRow,
  toMcpAgentActionRow,
  toMcpAuditEventRow,
  toMcpAuditHistoryEntry,
} from './mcp-audit-read.mapper.js';
import type {
  getAgentActionInputSchema,
  getEntityHistoryInputSchema,
  listAgentActionsInputSchema,
  listAuditEventsInputSchema,
} from './mcp-tool-schemas.js';

type ListAuditEventsInput = z.infer<typeof listAuditEventsInputSchema>;
type GetEntityHistoryInput = z.infer<typeof getEntityHistoryInputSchema>;
type GetAgentActionInput = z.infer<typeof getAgentActionInputSchema>;
type ListAgentActionsInput = z.infer<typeof listAgentActionsInputSchema>;

const AUDIT_NEWEST_FIRST: Prisma.AuditLogOrderByWithRelationInput[] = [
  { occurred_at: 'desc' },
  { id: 'desc' },
];
const AUDIT_OLDEST_FIRST: Prisma.AuditLogOrderByWithRelationInput[] = [
  { occurred_at: 'asc' },
  { id: 'asc' },
];
const AGENT_ACTION_NEWEST_FIRST: Prisma.AgentActionLogOrderByWithRelationInput[] =
  [{ created_at: 'desc' }, { id: 'desc' }];
const AGENT_ACTION_OLDEST_FIRST: Prisma.AgentActionLogOrderByWithRelationInput[] =
  [{ created_at: 'asc' }, { id: 'asc' }];

/** Audit entries returned alongside one trace. list_audit_events pages the rest by trace_id. */
const TRACE_AUDIT_ENTRY_LIMIT = MCP_MAX_PAGE_SIZE;

function decodeCursorOrThrow(cursor: string): McpKeysetCursor {
  const decoded = decodeMcpKeysetCursor(cursor);
  if (!decoded) {
    throw new BadRequestException('cursor is invalid');
  }
  return decoded;
}

/** Rows strictly older than the cursor, for newest-first audit pages. */
function auditOlderThan(cursor: McpKeysetCursor): Prisma.AuditLogWhereInput {
  const at = new Date(cursor.at);
  return {
    OR: [
      { occurred_at: { lt: at } },
      { occurred_at: at, id: { lt: cursor.id } },
    ],
  };
}

/** Rows strictly newer than the cursor, for oldest-first trace pages. */
function agentActionNewerThan(
  cursor: McpKeysetCursor,
): Prisma.AgentActionLogWhereInput {
  const at = new Date(cursor.at);
  return {
    OR: [{ created_at: { gt: at } }, { created_at: at, id: { gt: cursor.id } }],
  };
}

/** Rows strictly older than the cursor, for newest-first agent action pages. */
function agentActionOlderThan(
  cursor: McpKeysetCursor,
): Prisma.AgentActionLogWhereInput {
  const at = new Date(cursor.at);
  return {
    OR: [{ created_at: { lt: at } }, { created_at: at, id: { lt: cursor.id } }],
  };
}

/**
 * Read-only audit and agent action tools. Every query is scoped by the tenant
 * from the session. The reads show other users' activity, so they are limited
 * to the roles in MCP_SUPERVISOR_ROLES (OWNER and ADMIN).
 */
@Injectable()
export class McpAuditReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listAuditEvents(input: ListAuditEventsInput) {
    this.assertSupervisor();
    const tenantId = await this.tenantContext.getTenantId();
    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;

    const where = AuditQueryBuilder.buildWhere(tenantId, {
      entityType: input.entity_type,
      entityId: input.entity_id,
      action: input.action,
      actorUserId: input.actor,
      startDate: input.from ? normalizeMcpRangeStart(input.from) : undefined,
      endDate: input.to ? normalizeMcpRangeEnd(input.to) : undefined,
    });
    if (input.trace_id) {
      where.request_id = input.trace_id.toLowerCase();
    }
    if (input.cursor) {
      where.AND = [auditOlderThan(decodeCursorOrThrow(input.cursor))];
    }

    const records = await this.prisma.auditLog.findMany({
      where,
      orderBy: AUDIT_NEWEST_FIRST,
      take: pageSize + 1,
    });
    return buildMcpKeysetPage({
      records,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.occurred_at, record.id),
      mapRow: toMcpAuditEventRow,
    });
  }

  async getEntityHistory(input: GetEntityHistoryInput) {
    this.assertSupervisor();
    const tenantId = await this.tenantContext.getTenantId();
    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;

    const where = AuditQueryBuilder.buildWhere(tenantId, {
      entityType: input.entity_type,
      entityId: input.entity_id,
    });
    if (input.cursor) {
      where.AND = [auditOlderThan(decodeCursorOrThrow(input.cursor))];
    }

    const records = await this.prisma.auditLog.findMany({
      where,
      orderBy: AUDIT_NEWEST_FIRST,
      take: pageSize + 1,
    });
    return buildMcpKeysetPage({
      records,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.occurred_at, record.id),
      mapRow: toMcpAuditHistoryEntry,
    });
  }

  /** Log rows for one trace, oldest first, with the audit entries correlated on request_id. */
  async getAgentAction(input: GetAgentActionInput) {
    this.assertSupervisor();
    const tenantId = await this.tenantContext.getTenantId();
    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;
    const traceId = input.trace_id.toLowerCase();

    const logWhere: Prisma.AgentActionLogWhereInput = {
      tenant_id: tenantId,
      trace_id: traceId,
    };
    if (input.cursor) {
      logWhere.AND = [agentActionNewerThan(decodeCursorOrThrow(input.cursor))];
    }
    const logs = await this.prisma.agentActionLog.findMany({
      where: logWhere,
      orderBy: AGENT_ACTION_OLDEST_FIRST,
      take: pageSize + 1,
    });
    if (logs.length === 0 && !input.cursor) {
      throw new NotFoundException(
        `No agent action log entries found for trace ${traceId}`,
      );
    }

    const auditRecords = await this.prisma.auditLog.findMany({
      where: { tenant_id: tenantId, request_id: traceId },
      orderBy: AUDIT_OLDEST_FIRST,
      take: TRACE_AUDIT_ENTRY_LIMIT + 1,
    });
    return buildMcpKeysetPage({
      records: logs,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.created_at, record.id),
      mapRow: toMcpAgentActionDetailRow,
      extra: {
        trace_id: traceId,
        audit_entries: auditRecords
          .slice(0, TRACE_AUDIT_ENTRY_LIMIT)
          .map(toMcpAuditEventRow),
        audit_truncated: auditRecords.length > TRACE_AUDIT_ENTRY_LIMIT,
      },
    });
  }

  async listAgentActions(input: ListAgentActionsInput) {
    this.assertSupervisor();
    const tenantId = await this.tenantContext.getTenantId();
    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;

    const where = buildAgentActionWhere(tenantId, {
      agentId: input.agent,
      tier: input.tier,
      status: input.status,
      startDate: input.from ? normalizeMcpRangeStart(input.from) : undefined,
      endDate: input.to ? normalizeMcpRangeEnd(input.to) : undefined,
    });
    if (input.tool) {
      where.input_summary_json = { path: ['tool'], equals: input.tool };
    }
    if (input.cursor) {
      where.AND = [agentActionOlderThan(decodeCursorOrThrow(input.cursor))];
    }

    const records = await this.prisma.agentActionLog.findMany({
      where,
      orderBy: AGENT_ACTION_NEWEST_FIRST,
      take: pageSize + 1,
    });
    return buildMcpKeysetPage({
      records,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.created_at, record.id),
      mapRow: toMcpAgentActionRow,
    });
  }

  /** The session's role decides access. The check runs before any query. */
  private assertSupervisor(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    if (!isMcpSupervisorRole(role)) {
      throw new ForbiddenException(
        'Tenant owner or admin access is required for audit and agent action reads.',
      );
    }
  }
}
