import { AsyncLocalStorage } from 'node:async_hooks';
import { AgentPolicyTier } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type FakeSpan = {
  name: string;
  op: string;
  attributes: Record<string, unknown>;
  parent: FakeSpan | undefined;
  setAttribute(key: string, value: unknown): void;
  setAttributes(attributes: Record<string, unknown>): void;
};

// A minimal Sentry stand-in that nests spans through AsyncLocalStorage, so awaits keep the parent.
const activeSpan = new AsyncLocalStorage<FakeSpan>();
const recordedSpans: FakeSpan[] = [];

jest.unstable_mockModule('@sentry/node', () => ({
  getClient: () => ({}),
  getActiveSpan: () => activeSpan.getStore(),
  startSpan: (
    options: {
      name: string;
      op: string;
      attributes?: Record<string, unknown>;
    },
    callback: (span: FakeSpan) => unknown,
  ) => {
    const span: FakeSpan = {
      name: options.name,
      op: options.op,
      attributes: { ...options.attributes },
      parent: activeSpan.getStore(),
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      setAttributes(attributes) {
        Object.assign(this.attributes, attributes);
      },
    };
    recordedSpans.push(span);
    return activeSpan.run(span, () => callback(span));
  },
}));

const { McpWritePipelineService } = await import(
  './mcp-write-pipeline.service.js'
);

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
  return new McpWritePipelineService(
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

describe('McpWritePipelineService spans', () => {
  beforeEach(() => {
    recordedSpans.length = 0;
  });

  const spansByOp = (op: string) =>
    recordedSpans.filter((span) => span.op === op);

  it('records one agent.action span per write with an agent.decision child', async () => {
    const service = buildService(AgentPolicyTier.AUTO);

    await service.run(execution, { reservation: 'x' }, context);

    const actions = spansByOp('agent.action');
    expect(actions).toHaveLength(1);
    expect(actions[0].name).toBe('Agent action');
    expect(actions[0].attributes).toMatchObject({
      'agent.action.type': 'mcp.reserve_part',
      'agent.policy.tier': AgentPolicyTier.AUTO,
      'agent.trace_id': 'trace-1',
    });

    const decisions = spansByOp('agent.decision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].parent).toBe(actions[0]);
    expect(decisions[0].attributes).toMatchObject({
      'agent.policy.outcome': 'allowed',
    });
  });

  it('marks a HUMAN_ONLY call as refused and still closes its spans', async () => {
    const service = buildService(AgentPolicyTier.HUMAN_ONLY);

    await expect(
      service.run(execution, { reservation: 'x' }, context),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const decisions = spansByOp('agent.decision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].attributes).toMatchObject({
      'agent.policy.outcome': 'refused',
    });
    expect(spansByOp('agent.action')).toHaveLength(1);
  });

  it('marks a PROPOSE call as proposed', async () => {
    const service = buildService(AgentPolicyTier.PROPOSE);

    await service.run(execution, { reservation: 'x' }, context);

    expect(spansByOp('agent.decision')[0].attributes).toMatchObject({
      'agent.policy.outcome': 'proposed',
    });
  });
});
