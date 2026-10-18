import { AgentPolicyTier } from '@prisma/client';

const recordedSpans: { name: string; attributes: Record<string, unknown> }[] =
  [];

jest.unstable_mockModule('@sentry/node', () => ({
  startSpan: (
    options: { name: string; attributes?: Record<string, unknown> },
    callback: (span: { setAttribute: (k: string, v: unknown) => void }) => unknown,
  ) => {
    const span = {
      name: options.name,
      attributes: options.attributes ?? {},
      setAttribute(key: string, value: unknown) {
        this.attributes[key] = value;
      },
    };
    recordedSpans.push(span);
    return callback(span);
  },
}));

const { McpWritePipelineHost } = await import('./mcp-write-pipeline.host.js');

function buildService(tier: AgentPolicyTier) {
  const agentPolicy = {
    evaluateAction: jest.fn(async () => ({
      tier,
      reasons: ['test_reason'],
      rule_id: 'rule-1',
      rule_version: 1,
    })),
  };
  const dryRun = {
    executeInRollbackTransaction: jest.fn(
      async (fn: () => Promise<unknown>) => ({
        result: await fn(),
        wouldChange: [],
      }),
    ),
  };
  const agentActionLog = {
    record: jest.fn(async () => ({
      id: 'log-1',
      traceId: 'trace-1',
      workResult: { id: 'reservation-1' },
    })),
    recordInTransaction: jest.fn(async () => ({
      id: 'log-1',
      traceId: 'trace-1',
      workResult: { id: 'reservation-1' },
    })),
  };
  const prisma = {
    $transaction: jest.fn(
      async (
        callback: (tx: {
          tag: 'tx';
          agentProposal: { create: jest.Mock };
        }) => unknown,
      ) =>
        callback({
          tag: 'tx',
          agentProposal: {
            create: jest.fn(async () => ({ id: 'pending-1' })),
          },
        }),
    ),
  };
  const agentProposals = {
    persistPendingAction: jest.fn(async () => ({ id: 'pending-1' })),
  };
  const commandIdempotency = {
    beginOrReplay: jest.fn(async () => ({
      kind: 'execute',
      claim: { receiptId: 'receipt-1', originalTraceId: 'trace-claim' },
    })),
    completeInTransaction: jest.fn(async () => undefined),
    abandon: jest.fn(async () => undefined),
  };
  const requestContext = { getTraceId: () => 'trace-claim' };
  const tenantContext = { getTenantId: async () => 'tenant-1' };
  const workshopBookingPackage = {
    enrichInput: async (input: unknown) => input,
  };
  const workshopOrderCompletion = {
    enrichInput: async (input: unknown) => input,
  };
  const invoiceWorkshopDraftPropose = {
    enrichInput: async (input: unknown) => input,
  };
  const workshopEstimateSendPropose = {
    enrichInput: async (input: unknown) => input,
  };
  return new McpWritePipelineHost(
    prisma as never,
    agentPolicy as never,
    dryRun as never,
    agentActionLog as never,
    agentProposals as never,
    commandIdempotency as never,
    requestContext as never,
    tenantContext as never,
    workshopBookingPackage as never,
    workshopOrderCompletion as never,
    invoiceWorkshopDraftPropose as never,
    workshopEstimateSendPropose as never,
  );
}

const execution = {
  toolName: 'reserve_part',
  policyActionType: 'inventory.part_reserve',
  buildPolicyContext: async () => ({}),
  execute: async () => ({ id: 'reservation-1' }),
  buildResultSummary: () => ({ id: 'reservation-1' }),
} as never;

const context = { agentId: 'agent-1', onBehalfOfUserId: 'user-1' };

describe('McpWritePipelineHost spans', () => {
  beforeEach(() => {
    recordedSpans.length = 0;
  });

  it('records agent.action and agent.decision spans for AUTO tier', async () => {
    const service = buildService(AgentPolicyTier.AUTO);
    await service.run(
      execution,
      { catalog_item_id: 'part-1', quantity: '1', bin_id: 'bin-1' },
      context,
    );
    expect(recordedSpans.map((span) => span.name)).toEqual([
      'Agent action',
      'Agent decision',
    ]);
  });
});
