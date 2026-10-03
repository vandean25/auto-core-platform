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
    getTraceId: jest.fn().mockReturnValue('00000000-0000-4000-8000-00000000aa01'),
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
});
