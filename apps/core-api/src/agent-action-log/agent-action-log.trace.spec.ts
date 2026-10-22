import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { AgentActionRecordInput } from './agent-action-log.types.js';

const mockGetClient = jest.fn();
const mockGetActiveSpan = jest.fn();

jest.unstable_mockModule('@sentry/node', () => ({
  getClient: mockGetClient,
  getActiveSpan: mockGetActiveSpan,
  startSpan: jest.fn(),
  getCurrentScope: jest.fn(),
  getIsolationScope: jest.fn(),
  getTraceData: jest.fn(),
}));

const { AgentActionLogService } = await import(
  './agent-action-log.service.js'
);

const TRACE_ID = '00000000-0000-4000-8000-00000000cc03';

const actionInput: AgentActionRecordInput = {
  actorType: 'AGENT',
  agentId: 'mcp:test',
  actionType: 'customer.update',
  tier: 'AUTO',
  status: 'EXECUTED',
  traceId: TRACE_ID,
  inputSummary: { field: 'first_name' },
};

describe('AgentActionLogService agent.trace_id on the active span', () => {
  const activeSpan = { setAttributes: jest.fn(), setAttribute: jest.fn() };
  let service: InstanceType<typeof AgentActionLogService>;
  let prisma: { agentActionLog: { create: jest.Mock } };
  let transaction: { agentActionLog: { create: jest.Mock } };

  beforeEach(() => {
    mockGetClient.mockReset();
    mockGetActiveSpan.mockReset();
    activeSpan.setAttributes.mockReset();
    activeSpan.setAttribute.mockReset();
    mockGetClient.mockReturnValue({});
    mockGetActiveSpan.mockReturnValue(activeSpan);

    prisma = {
      agentActionLog: {
        create: jest.fn(async () => ({ id: 'log-1', trace_id: TRACE_ID })),
      },
    };
    transaction = {
      agentActionLog: {
        create: jest.fn(async () => ({ id: 'log-2', trace_id: TRACE_ID })),
      },
    };
    service = new AgentActionLogService(
      prisma as unknown as PrismaService,
      { getTenantId: jest.fn(async () => 'tenant-1') } as unknown as TenantContextService,
      {
        getTraceId: jest.fn(() => TRACE_ID),
      } as unknown as RequestContextService,
    );
  });

  it('writes agent.trace_id onto the active span when a log row is recorded', async () => {
    await service.record(actionInput);

    expect(prisma.agentActionLog.create).toHaveBeenCalledTimes(1);
    expect(activeSpan.setAttributes).toHaveBeenCalledWith({
      'agent.trace_id': TRACE_ID,
    });
  });

  it('writes agent.trace_id onto the active span for a row recorded inside a transaction', async () => {
    await service.recordInTransaction(
      actionInput,
      transaction as never,
    );

    expect(transaction.agentActionLog.create).toHaveBeenCalledTimes(1);
    expect(activeSpan.setAttributes).toHaveBeenCalledWith({
      'agent.trace_id': TRACE_ID,
    });
  });

  it('writes nothing when Sentry is not initialised, and still records the row', async () => {
    mockGetClient.mockReturnValue(undefined);

    await service.record(actionInput);

    expect(mockGetActiveSpan).not.toHaveBeenCalled();
    expect(activeSpan.setAttributes).not.toHaveBeenCalled();
    expect(prisma.agentActionLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not fail the write when no span is active', async () => {
    mockGetActiveSpan.mockReturnValue(undefined);

    await expect(service.record(actionInput)).resolves.toMatchObject({
      traceId: TRACE_ID,
    });
  });
});
