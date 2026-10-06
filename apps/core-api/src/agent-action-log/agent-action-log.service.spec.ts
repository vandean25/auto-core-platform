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
});
