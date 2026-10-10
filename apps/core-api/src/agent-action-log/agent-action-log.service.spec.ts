import { Test, TestingModule } from '@nestjs/testing';
import { AgentActionLogService } from './agent-action-log.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { AgentActionLogActorType } from '@prisma/client';

describe('AgentActionLogService', () => {
  let service: AgentActionLogService;
  const prisma = {
    agentActionLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };

  const requestContext = {
    getTraceId: jest
      .fn()
      .mockReturnValue('00000000-0000-4000-8000-00000000aa01'),
  };

  const expectAppendOnlyRecord = () => {
    expect(prisma.agentActionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.agentActionLog.update).not.toHaveBeenCalled();
    expect(prisma.agentActionLog.delete).not.toHaveBeenCalled();
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentActionLogService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: RequestContextService, useValue: requestContext },
      ],
    }).compile();

    service = module.get(AgentActionLogService);
    prisma.agentActionLog.create.mockResolvedValue({
      id: 'log-1',
      trace_id: '00000000-0000-4000-8000-00000000aa01',
    });
  });

  it('record persists a log row and can run correlated work', async () => {
    const traceId = '00000000-0000-4000-8000-00000000bb02';
    let observedCorrelation: string | undefined;

    await TenantContextStorage.run(async () => {
      TenantContextStorage.setUser({
        userId: 'user-1',
        email: 'admin@example.com',
        tenantId: 'tenant-1',
        role: 'ADMIN',
      });
      TenantContextStorage.setRequestMeta({
        requestId: 'req-1',
        traceId,
        source: 'API',
      });

      return await service.record(
        {
          actorType: 'AGENT',
          agentId: 'mcp:test',
          actionType: 'customer.update',
          tier: 'AUTO',
          status: 'EXECUTED',
          traceId,
          inputSummary: { field: 'first_name' },
        },
        async () => {
          observedCorrelation =
            TenantContextStorage.getRequestMeta()?.auditCorrelationId;
          return { ok: true };
        },
      );
    });

    expect(observedCorrelation).toBe(traceId);
    expectAppendOnlyRecord();
    expect(prisma.agentActionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          trace_id: traceId,
          actor_type: AgentActionLogActorType.AGENT,
          agent_id: 'mcp:test',
        }),
      }),
    );
  });

  it('persists reversible entity metadata derived from successful work', async () => {
    const traceId = '00000000-0000-4000-8000-00000000dd04';

    await TenantContextStorage.run(async () => {
      TenantContextStorage.setUser({
        userId: 'user-1',
        email: 'admin@example.com',
        tenantId: 'tenant-1',
        role: 'ADMIN',
      });
      TenantContextStorage.setRequestMeta({
        requestId: 'req-1',
        traceId,
        source: 'API',
      });

      await service.record(
        {
          actorType: 'AGENT',
          agentId: 'mcp:test',
          actionType: 'mcp.reserve_part',
          tier: 'AUTO',
          status: 'EXECUTED',
          traceId,
        },
        async () => ({ id: 'reservation-1' }),
        (result) => ({
          entityType: 'PartsReservation',
          entityId: result?.id,
          reversible: true,
        }),
      );
    });

    expect(prisma.agentActionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity_type: 'PartsReservation',
          entity_id: 'reservation-1',
          reversible: true,
        }),
      }),
    );
  });

  it('persists FAILED when work throws and then rethrows', async () => {
    const traceId = '00000000-0000-4000-8000-00000000cc03';

    await expect(
      TenantContextStorage.run(async () => {
        TenantContextStorage.setUser({
          userId: 'user-1',
          email: 'admin@example.com',
          tenantId: 'tenant-1',
          role: 'ADMIN',
        });
        TenantContextStorage.setRequestMeta({
          requestId: 'req-1',
          traceId,
          source: 'API',
        });

        return service.record(
          {
            actorType: 'AGENT',
            agentId: 'mcp:test',
            actionType: 'customer.update',
            tier: 'AUTO',
            status: 'EXECUTED',
            traceId,
          },
          async () => {
            throw new Error('work failed');
          },
        );
      }),
    ).rejects.toThrow('work failed');

    expectAppendOnlyRecord();
    expect(prisma.agentActionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          result_summary_json: { error: 'work failed' },
        }),
      }),
    );
  });

  it('writes a decision log through the supplied transaction with agent attribution', async () => {
    const transaction = {
      agentActionLog: {
        create: jest.fn().mockResolvedValue({
          id: 'decision-log-1',
          trace_id: '00000000-0000-4000-8000-00000000aa01',
        }),
      },
    } as any;

    await service.recordInTransaction(
      {
        traceId: '00000000-0000-4000-8000-00000000aa01',
        actorType: 'USER',
        agentId: 'workshop-agent',
        onBehalfOfUserId: 'supervisor-1',
        actionType: 'workshop_order.add_line',
        tier: 'PROPOSE',
        status: 'REJECTED',
      },
      transaction,
    );

    expect(transaction.agentActionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agent_id: 'workshop-agent',
          status: 'REJECTED',
        }),
      }),
    );
    expect(prisma.agentActionLog.create).not.toHaveBeenCalled();
  });

  it('runs transactional work with the proposal trace attached to audit context', async () => {
    const traceId = '00000000-0000-4000-8000-00000000ee05';
    const transaction = {
      agentActionLog: {
        create: jest.fn().mockResolvedValue({ id: 'decision-log-2' }),
      },
    } as any;
    let observedAuditTrace: string | undefined;

    await TenantContextStorage.run(async () => {
      TenantContextStorage.setRequestMeta({
        requestId: 'req-transaction',
        traceId: '00000000-0000-4000-8000-00000000ff06',
        source: 'API',
      });

      await service.recordInTransaction(
        {
          traceId,
          actorType: 'USER',
          agentId: 'workshop-agent',
          actionType: 'workshop_order.add_line',
          tier: 'PROPOSE',
          status: 'EXECUTED',
        },
        transaction,
        async () => {
          observedAuditTrace =
            TenantContextStorage.getRequestMeta()?.auditCorrelationId;
          return { entityId: 'line-1' };
        },
      );
    });

    expect(observedAuditTrace).toBe(traceId);
    expect(transaction.agentActionLog.create).toHaveBeenCalledTimes(1);
  });

  it('returns decision entries when filtering by their originating agent', async () => {
    prisma.agentActionLog.findMany.mockResolvedValue([
      {
        id: 'decision-log-1',
        tenant_id: 'tenant-1',
        trace_id: '00000000-0000-4000-8000-00000000aa01',
        parent_trace_id: null,
        actor_type: 'USER',
        agent_id: 'workshop-agent',
        on_behalf_of_user_id: 'supervisor-1',
        action_type: 'workshop_order.add_line',
        tier: 'PROPOSE',
        status: 'REJECTED',
        input_summary_json: {},
        result_summary_json: {},
        entity_type: null,
        entity_id: null,
        reversible: false,
        reverted_by_log_id: null,
        created_at: new Date('2026-10-06T00:00:00.000Z'),
      },
    ]);

    const result = await service.findAll({ agentId: 'workshop-agent' });

    expect(prisma.agentActionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-1', agent_id: 'workshop-agent' },
      }),
    );
    expect(result.data[0]?.agentId).toBe('workshop-agent');
  });

  describe('on-behalf-of contact', () => {
    const decisionRow = {
      id: 'decision-log-2',
      tenant_id: 'tenant-1',
      trace_id: '00000000-0000-4000-8000-00000000aa02',
      parent_trace_id: null,
      actor_type: 'USER',
      agent_id: 'mcp:qa-fresh-agent',
      on_behalf_of_user_id: 'supervisor-1',
      action_type: 'sales_order.apply_discount',
      tier: 'PROPOSE',
      status: 'EXECUTED',
      input_summary_json: {},
      result_summary_json: {},
      entity_type: null,
      entity_id: null,
      reversible: false,
      reverted_by_log_id: null,
      created_at: new Date('2026-10-06T00:00:00.000Z'),
    };

    it('adds the on-behalf-of name and email to list rows from one tenant-scoped query', async () => {
      prisma.agentActionLog.findMany.mockResolvedValue([decisionRow]);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'supervisor-1',
          email: 'sam@example.com',
          firstName: 'Sam',
          lastName: 'Supervisor',
        },
      ]);

      const result = await service.findAll({});

      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['supervisor-1'] },
          memberships: { some: { tenant_id: 'tenant-1' } },
        },
        select: { id: true, email: true, firstName: true, lastName: true },
      });
      expect(result.data[0]).toMatchObject({
        agentId: 'mcp:qa-fresh-agent',
        onBehalfOfUserId: 'supervisor-1',
        onBehalfOfUserName: 'Sam Supervisor',
        onBehalfOfUserEmail: 'sam@example.com',
      });
    });

    it('keeps the on-behalf-of name and email null for a user outside the tenant', async () => {
      prisma.agentActionLog.findMany.mockResolvedValue([
        { ...decisionRow, on_behalf_of_user_id: 'user-outside-tenant' },
      ]);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.findAll({});

      expect(result.data[0]).toMatchObject({
        onBehalfOfUserId: 'user-outside-tenant',
        onBehalfOfUserName: null,
        onBehalfOfUserEmail: null,
      });
    });

    it('adds the on-behalf-of contact to the trace detail logs', async () => {
      prisma.agentActionLog.findMany.mockResolvedValue([decisionRow]);
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'supervisor-1',
          email: 'sam@example.com',
          firstName: 'Sam',
          lastName: 'Supervisor',
        },
      ]);

      const result = await service.findByTraceId(decisionRow.trace_id);

      expect(result.logs[0]).toMatchObject({
        onBehalfOfUserId: 'supervisor-1',
        onBehalfOfUserName: 'Sam Supervisor',
        onBehalfOfUserEmail: 'sam@example.com',
      });
    });
  });

  it('persists the NOT_EVALUATED tier for writes rejected before policy evaluation', async () => {
    await service.record({
      actorType: 'AGENT',
      agentId: 'mcp:test',
      onBehalfOfUserId: 'user-1',
      actionType: 'mcp.draft_workshop_order',
      tier: 'NOT_EVALUATED',
      status: 'FAILED',
      inputSummary: { tool: 'draft_workshop_order' },
      resultSummary: { error: 'Invalid input' },
    });

    expectAppendOnlyRecord();
    expect(prisma.agentActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tier: 'NOT_EVALUATED',
        status: 'FAILED',
        action_type: 'mcp.draft_workshop_order',
      }),
    });
  });
});
