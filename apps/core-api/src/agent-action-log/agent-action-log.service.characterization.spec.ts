import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentActionLogService } from './agent-action-log.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';

/** Runs a call inside the request context that audit-traced work requires, as the HTTP layer does. */
const inRequestContext = <T>(call: () => Promise<T>): Promise<T> =>
  TenantContextStorage.run(async () => {
    TenantContextStorage.setUser({
      userId: 'user-1',
      email: 'admin@example.com',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    TenantContextStorage.setRequestMeta({
      requestId: 'req-1',
      traceId: '00000000-0000-4000-8000-00000000cc01',
      source: 'API',
    });
    return call();
  });

/**
 * Characterizes how AgentActionLogService turns work outcomes into log rows and how the read
 * paths validate and page. The assertions pin the persisted row and the error each path throws.
 */
describe('AgentActionLogService characterization', () => {
  const traceId = '00000000-0000-4000-8000-00000000cc01';
  let service: AgentActionLogService;
  const prisma = {
    agentActionLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  };
  const tenantContext = {
    getTenantId: jest.fn(),
  };
  const requestContext = {
    getTraceId: jest.fn(),
  };

  const baseInput = {
    actorType: 'AGENT' as const,
    agentId: 'mcp:test',
    actionType: 'customer.update',
    tier: 'AUTO' as const,
    status: 'EXECUTED' as const,
    traceId,
    inputSummary: { field: 'first_name' },
  };

  const logRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'log-1',
    tenant_id: 'tenant-1',
    trace_id: traceId,
    parent_trace_id: null,
    actor_type: 'AGENT',
    agent_id: 'mcp:test',
    on_behalf_of_user_id: null,
    api_key_id: null,
    action_type: 'customer.update',
    tier: 'AUTO',
    status: 'EXECUTED',
    input_summary_json: {},
    result_summary_json: {},
    entity_type: null,
    entity_id: null,
    reversible: false,
    reverted_by_log_id: null,
    created_at: new Date('2026-10-10T10:00:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    tenantContext.getTenantId.mockResolvedValue('tenant-1');
    requestContext.getTraceId.mockReturnValue(traceId);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.agentActionLog.create.mockResolvedValue({ id: 'log-1' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentActionLogService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: RequestContextService, useValue: requestContext },
      ],
    }).compile();
    service = module.get(AgentActionLogService);
  });

  describe('record', () => {
    it('refuses to record without a trace id on the input or the request', async () => {
      requestContext.getTraceId.mockReturnValue(undefined);

      const error = await service
        .record({ ...baseInput, traceId: undefined })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({
        message:
          'traceId is required when no request trace context is available',
      });
      expect(prisma.agentActionLog.create).not.toHaveBeenCalled();
    });

    it('persists FAILED with the error text when work throws a string, then rethrows it as an Error', async () => {
      // Rejecting with a bare string is the case under test: the row stores the text, not an Error.
      const error = await inRequestContext(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        service.record(baseInput, () => Promise.reject('boom')),
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ message: 'boom' });
      expect(prisma.agentActionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'FAILED',
          result_summary_json: { error: 'boom' },
        }),
      });
    });

    it('persists FAILED with the generic message when work throws a value that is neither an Error nor a string', async () => {
      // A non-Error, non-string rejection is the case under test: the row gets the generic message.
      const error = await inRequestContext(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        service.record(baseInput, () => Promise.reject(42)),
      ).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ message: 'Agent action work failed' });
      expect(prisma.agentActionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'FAILED',
          result_summary_json: { error: 'Agent action work failed' },
        }),
      });
    });

    it('keeps the input status, the summary and the entity fields when work succeeds', async () => {
      const resultSummary = jest.fn((result: { id: string } | undefined) => ({
        produced: result?.id ?? null,
      }));

      const recorded = await inRequestContext(() =>
        service.record(
          {
            ...baseInput,
            resultSummary,
            entityType: 'Customer',
            entityId: 'customer-input',
            reversible: false,
          },
          async () => ({ id: 'customer-7' }),
          () => ({ entityType: 'Customer', entityId: 'customer-7', reversible: true }),
        ),
      );

      expect(recorded).toMatchObject({ id: 'log-1', traceId });
      expect(recorded.workResult).toEqual({ id: 'customer-7' });
      expect(resultSummary).toHaveBeenCalledWith({ id: 'customer-7' });
      expect(prisma.agentActionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'EXECUTED',
          result_summary_json: { produced: 'customer-7' },
          entity_type: 'Customer',
          entity_id: 'customer-7',
          reversible: true,
        }),
      });
    });

    it('ignores result metadata and summarizes the error when work fails', async () => {
      const metadataFromResult = jest.fn(() => ({
        entityType: 'Customer',
        entityId: 'customer-7',
        reversible: true,
      }));

      await inRequestContext(() =>
        service.record(
          { ...baseInput, entityType: 'Vehicle', entityId: 'vehicle-1' },
          () => Promise.reject(new Error('denied')),
          metadataFromResult,
        ),
      ).catch(() => undefined);

      expect(metadataFromResult).not.toHaveBeenCalled();
      expect(prisma.agentActionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'FAILED',
          result_summary_json: { error: 'denied' },
          entity_type: 'Vehicle',
          entity_id: 'vehicle-1',
          reversible: false,
        }),
      });
    });

    it('records without work and keeps the input summary as the result summary', async () => {
      const recorded = await service.record({
        ...baseInput,
        resultSummary: { ok: true },
      });

      expect(recorded.workResult).toBeUndefined();
      expect(prisma.agentActionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'EXECUTED',
          result_summary_json: { ok: true },
        }),
      });
    });
  });

  describe('recordInTransaction', () => {
    it('propagates work errors without writing a row', async () => {
      const transaction = {
        agentActionLog: { create: jest.fn() },
      };

      await expect(
        inRequestContext(() =>
          service.recordInTransaction(
            baseInput,
            transaction as never,
            () => Promise.reject(new Error('inside transaction')),
          ),
        ),
      ).rejects.toThrow('inside transaction');
      expect(transaction.agentActionLog.create).not.toHaveBeenCalled();
    });

    it('writes the parsed status and summary when no work is supplied', async () => {
      const transaction = {
        agentActionLog: { create: jest.fn().mockResolvedValue({ id: 'log-2' }) },
      };

      const recorded = await service.recordInTransaction(
        { ...baseInput, resultSummary: { queued: true } },
        transaction as never,
      );

      expect(recorded).toEqual({ id: 'log-2', traceId, workResult: undefined });
      expect(transaction.agentActionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'EXECUTED',
          result_summary_json: { queued: true },
          entity_type: null,
          entity_id: null,
          reversible: false,
        }),
      });
    });
  });

  describe('reads', () => {
    it('rejects a trace id that is not a UUID before querying', async () => {
      await expect(service.findByTraceId('not-a-uuid')).rejects.toThrow(
        new BadRequestException('traceId must be a UUID'),
      );
      expect(prisma.agentActionLog.findMany).not.toHaveBeenCalled();
    });

    it('reports a trace with no log entries as not found', async () => {
      prisma.agentActionLog.findMany.mockResolvedValue([]);

      const error = await service
        .findByTraceId(traceId)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).toMatchObject({
        message: `No agent action log entries found for trace ${traceId}`,
      });
    });

    it('returns a next cursor only when more rows exist beyond the default page of 20', async () => {
      const rows = Array.from({ length: 21 }, (_, index) =>
        logRow({
          id: `log-${index}`,
          created_at: new Date(Date.UTC(2026, 9, 10, 10, 0, 21 - index)),
        }),
      );
      prisma.agentActionLog.findMany.mockResolvedValue(rows);

      const page = await service.findAll({});

      expect(prisma.agentActionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 21 }),
      );
      expect(page.data).toHaveLength(20);
      expect(page.nextCursor).not.toBeNull();
    });

    it('returns no next cursor when the page holds every row', async () => {
      prisma.agentActionLog.findMany.mockResolvedValue([logRow(), logRow({ id: 'log-2' })]);

      const page = await service.findAll({ limit: 5 });

      expect(page.data).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });
  });
});
