import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { McpAuditReadService } from './mcp-audit-read.service.js';
import { encodeMcpKeysetCursor } from './mcp-output.util.js';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const TRACE_ID = '6f1c2b7e-3d4a-4b8e-9c2d-1a2b3c4d5e6f';
const USER_ID = '00000000-0000-4000-8000-0000000000b1';
const ROW_ID = '00000000-0000-4000-8000-0000000000a1';

type Built = {
  service: McpAuditReadService;
  prisma: {
    auditLog: { findMany: jest.Mock };
    agentActionLog: { findMany: jest.Mock };
  };
  tenantContext: { getTenantId: jest.Mock; getAuthenticatedUser: jest.Mock };
};

function build(options: { role?: string; tenantId?: string } = {}): Built {
  const prisma = {
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    agentActionLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(options.tenantId ?? TENANT_A),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      userId: USER_ID,
      email: 'owner@example.com',
      tenantId: options.tenantId ?? TENANT_A,
      role: options.role ?? 'OWNER',
    }),
  };
  const service = new McpAuditReadService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
  );
  return { service, prisma, tenantContext };
}

function auditRow(index: number, occurredAt: string) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    tenant_id: TENANT_A,
    entity_type: 'Customer',
    entity_id: '00000000-0000-4000-8000-0000000000c1',
    action: 'UPDATE',
    actor_user_id: USER_ID,
    actor_email: null,
    actor_role: null,
    actor_type: 'USER',
    request_id: TRACE_ID,
    before: null,
    after: null,
    diff: null,
    occurred_at: new Date(occurredAt),
  };
}

function agentLogRow() {
  return {
    id: ROW_ID,
    trace_id: TRACE_ID,
    created_at: new Date('2026-10-10T08:00:00.000Z'),
    input_summary_json: null,
    result_summary_json: null,
    agent_id: 'mcp:cursor',
    on_behalf_of_user_id: USER_ID,
    action_type: 'workshop_order.create',
    tier: 'AUTO',
    status: 'EXECUTED',
    entity_type: null,
    entity_id: null,
  };
}

describe('McpAuditReadService', () => {
  describe('supervisor gate', () => {
    it.each([
      ['list_audit_events', (service: McpAuditReadService) => service.listAuditEvents({})],
      [
        'get_entity_history',
        (service: McpAuditReadService) =>
          service.getEntityHistory({ entity_type: 'Customer', entity_id: 'cust-1' }),
      ],
      [
        'get_agent_action',
        (service: McpAuditReadService) => service.getAgentAction({ trace_id: TRACE_ID }),
      ],
      ['list_agent_actions', (service: McpAuditReadService) => service.listAgentActions({})],
    ])(
      'refuses SALES and TECH callers in %s before any query runs',
      async (_tool, call) => {
        for (const role of ['SALES', 'TECH']) {
          const { service, prisma } = build({ role });

          await expect(call(service)).rejects.toBeInstanceOf(ForbiddenException);
          expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
          expect(prisma.agentActionLog.findMany).not.toHaveBeenCalled();
        }
      },
    );

    it.each(['OWNER', 'ADMIN'])('allows %s callers', async (role) => {
      const { service } = build({ role });

      await expect(service.listAuditEvents({})).resolves.toMatchObject({
        data: [],
      });
    });
  });

  describe('listAuditEvents', () => {
    it('scopes every query to the session tenant and maps each filter', async () => {
      const { service, prisma } = build();

      await service.listAuditEvents({
        entity_type: 'Customer',
        entity_id: 'cust-1',
        actor: USER_ID,
        action: 'UPDATE',
        from: '2026-10-01',
        to: '2026-10-31',
        trace_id: TRACE_ID,
        pageSize: 5,
      });

      const args = prisma.auditLog.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        tenant_id: TENANT_A,
        entity_type: 'Customer',
        entity_id: 'cust-1',
        action: 'UPDATE',
        actor_user_id: USER_ID,
        request_id: TRACE_ID,
        occurred_at: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lte: new Date('2026-10-31T23:59:59.999Z'),
        },
      });
      expect(args.take).toBe(6);
      expect(args.orderBy).toEqual([{ occurred_at: 'desc' }, { id: 'desc' }]);
    });

    it('lowercases a trace filter so it matches rows correlated under the lowercase trace', async () => {
      const { service, prisma } = build();

      await service.listAuditEvents({ trace_id: TRACE_ID.toUpperCase() });

      expect(prisma.auditLog.findMany.mock.calls[0][0].where.request_id).toBe(
        TRACE_ID,
      );
    });

    it('defaults to 10 rows per page and fetches one extra row to detect more pages', async () => {
      const { service, prisma } = build();

      await service.listAuditEvents({});

      expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(11);
    });

    it('applies a keyset cursor as a strictly older position', async () => {
      const { service, prisma } = build();
      const at = '2026-10-10T08:00:00.000Z';

      await service.listAuditEvents({
        cursor: encodeMcpKeysetCursor({ at, id: ROW_ID }),
      });

      expect(prisma.auditLog.findMany.mock.calls[0][0].where.AND).toEqual([
        {
          OR: [
            { occurred_at: { lt: new Date(at) } },
            { occurred_at: new Date(at), id: { lt: ROW_ID } },
          ],
        },
      ]);
    });

    it('returns a next cursor from the last row of a full page', async () => {
      const { service, prisma } = build();
      prisma.auditLog.findMany.mockResolvedValue([
        auditRow(3, '2026-10-10T08:03:00.000Z'),
        auditRow(2, '2026-10-10T08:02:00.000Z'),
        auditRow(1, '2026-10-10T08:01:00.000Z'),
      ]);

      const page = await service.listAuditEvents({ pageSize: 2 });

      expect(page.data).toHaveLength(2);
      expect(page.truncated).toBe(false);
      expect(page.meta.next_cursor).not.toBeNull();
    });

    it('rejects a malformed cursor before querying', async () => {
      const { service, prisma } = build();

      await expect(
        service.listAuditEvents({ cursor: 'not-a-cursor' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });

    it('ignores a tenant_id supplied in the arguments and uses the session tenant', async () => {
      const { service, prisma } = build({ tenantId: TENANT_A });

      await service.listAuditEvents({
        tenant_id: TENANT_B,
      } as unknown as Parameters<McpAuditReadService['listAuditEvents']>[0]);

      expect(prisma.auditLog.findMany.mock.calls[0][0].where.tenant_id).toBe(
        TENANT_A,
      );
    });
  });

  describe('getEntityHistory', () => {
    it('reads one entity within the session tenant, newest first', async () => {
      const { service, prisma } = build({ tenantId: TENANT_B });

      await service.getEntityHistory({
        entity_type: 'Vehicle',
        entity_id: 'veh-1',
        pageSize: 10,
      });

      expect(prisma.auditLog.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          tenant_id: TENANT_B,
          entity_type: 'Vehicle',
          entity_id: 'veh-1',
        },
        orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
        take: 11,
      });
    });

    it('applies a keyset cursor as a strictly older position', async () => {
      const { service, prisma } = build();
      const at = '2026-10-10T08:00:00.000Z';

      await service.getEntityHistory({
        entity_type: 'Customer',
        entity_id: 'cust-1',
        cursor: encodeMcpKeysetCursor({ at, id: ROW_ID }),
      });

      expect(prisma.auditLog.findMany.mock.calls[0][0].where.AND).toEqual([
        {
          OR: [
            { occurred_at: { lt: new Date(at) } },
            { occurred_at: new Date(at), id: { lt: ROW_ID } },
          ],
        },
      ]);
    });
  });

  describe('getAgentAction', () => {
    it('reports NotFound for a trace with no log rows in the session tenant', async () => {
      const { service, prisma } = build({ tenantId: TENANT_B });

      await expect(
        service.getAgentAction({ trace_id: TRACE_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.agentActionLog.findMany.mock.calls[0][0].where).toEqual({
        tenant_id: TENANT_B,
        trace_id: TRACE_ID,
      });
    });

    it('correlates audit entries on the trace within the session tenant and limits them to 25', async () => {
      const { service, prisma } = build();
      prisma.agentActionLog.findMany.mockResolvedValue([agentLogRow()]);
      prisma.auditLog.findMany.mockResolvedValue(
        Array.from({ length: 26 }, (_, index) =>
          auditRow(index + 1, '2026-10-10T08:00:00.000Z'),
        ),
      );

      const page = await service.getAgentAction({ trace_id: TRACE_ID });

      expect(prisma.auditLog.findMany.mock.calls[0][0]).toMatchObject({
        where: { tenant_id: TENANT_A, request_id: TRACE_ID },
        take: 26,
      });
      expect(page).toMatchObject({
        trace_id: TRACE_ID,
        audit_truncated: true,
      });
      expect(page.audit_entries).toHaveLength(25);
    });

    it('reads the trace in lowercase form whatever case the caller used', async () => {
      const { service, prisma } = build();
      prisma.agentActionLog.findMany.mockResolvedValue([agentLogRow()]);

      const page = await service.getAgentAction({
        trace_id: TRACE_ID.toUpperCase(),
      });

      expect(prisma.agentActionLog.findMany.mock.calls[0][0].where).toEqual({
        tenant_id: TENANT_A,
        trace_id: TRACE_ID,
      });
      expect(prisma.auditLog.findMany.mock.calls[0][0].where).toEqual({
        tenant_id: TENANT_A,
        request_id: TRACE_ID,
      });
      expect(page).toMatchObject({ trace_id: TRACE_ID });
    });

    it('applies a keyset cursor as a strictly newer position for the trace log rows', async () => {
      const { service, prisma } = build();
      const at = '2026-10-10T08:00:00.000Z';

      await service.getAgentAction({
        trace_id: TRACE_ID,
        cursor: encodeMcpKeysetCursor({ at, id: ROW_ID }),
      });

      expect(prisma.agentActionLog.findMany.mock.calls[0][0].where.AND).toEqual([
        {
          OR: [
            { created_at: { gt: new Date(at) } },
            { created_at: new Date(at), id: { gt: ROW_ID } },
          ],
        },
      ]);
    });
  });

  describe('listAgentActions', () => {
    it('filters by agent, tool, tier, status, and an inclusive time range within the session tenant', async () => {
      const { service, prisma } = build();

      await service.listAgentActions({
        agent: 'mcp:cursor',
        tool: 'reserve_part',
        tier: 'PROPOSE',
        status: 'PROPOSED',
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-31',
        pageSize: 25,
      });

      const args = prisma.agentActionLog.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        tenant_id: TENANT_A,
        agent_id: 'mcp:cursor',
        tier: 'PROPOSE',
        status: 'PROPOSED',
        input_summary_json: { path: ['tool'], equals: 'reserve_part' },
        created_at: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lte: new Date('2026-10-31T23:59:59.999Z'),
        },
      });
      expect(args.take).toBe(26);
      expect(args.orderBy).toEqual([{ created_at: 'desc' }, { id: 'desc' }]);
    });

    it('applies a keyset cursor as a strictly older position', async () => {
      const { service, prisma } = build();
      const at = '2026-10-10T08:00:00.000Z';

      await service.listAgentActions({
        cursor: encodeMcpKeysetCursor({ at, id: ROW_ID }),
      });

      expect(prisma.agentActionLog.findMany.mock.calls[0][0].where.AND).toEqual([
        {
          OR: [
            { created_at: { lt: new Date(at) } },
            { created_at: new Date(at), id: { lt: ROW_ID } },
          ],
        },
      ]);
    });
  });
});
