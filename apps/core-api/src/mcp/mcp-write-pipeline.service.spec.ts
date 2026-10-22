import { AgentPolicyTier } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { AgentPolicyEvaluationResult } from '../agent-policy/agent-policy.types.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import { McpWritePipelineService } from './mcp-write-pipeline.service.js';
import { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import type { McpWriteExecution, McpWriteToolContext } from './mcp-write-pipeline.service.js';
import { mcpWritePipelineMediaWeeklyTestProviders } from './mcp-write-weekly-report-pipeline.spec.support.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.js';

describe('McpWritePipelineService', () => {
  let service: McpWritePipelineService;
  let mockAgentPolicy: Pick<jest.Mocked<AgentPolicyService>, 'evaluateAction'>;
  let mockDryRun: Pick<
    jest.Mocked<DryRunService>,
    'executeInRollbackTransaction'
  >;
  let mockAgentActionLog: { record: jest.Mock; recordInTransaction: jest.Mock };
  let mockAgentProposals: Pick<
    jest.Mocked<AgentProposalService>,
    'persistPendingAction'
  >;
  let mockPrisma: { $transaction: jest.Mock };
  let mockCommandIdempotency: Pick<
    jest.Mocked<McpWriteCommandIdempotencyService>,
    'beginOrReplay' | 'completeInTransaction' | 'abandon'
  >;
  let mockRequestContext: Pick<jest.Mocked<RequestContextService>, 'getTraceId'>;
  let mockTenantContext: Pick<jest.Mocked<TenantContextService>, 'getTenantId'>;

  const mockContext: McpWriteToolContext = {
    agentId: 'test-agent',
    onBehalfOfUserId: 'test-user',
  };

  const createMockExecution = (
    toolName: 'propose_line_item' | 'draft_workshop_order' | 'reserve_part' | 'release_reservation',
  ): McpWriteExecution & { execute: jest.Mock } => {
    const executeFn = jest.fn().mockResolvedValue({ id: 'created-id' });
    const policyActionMap: Record<string, string> = {
      propose_line_item: 'workshop_order.propose_line',
      draft_workshop_order: 'workshop_order.create',
      reserve_part: 'inventory.part_reserve',
      release_reservation: 'inventory.part_release',
    };
    return {
      toolName,
      policyActionType: policyActionMap[toolName] ?? 'unknown',
      buildPolicyContext: jest.fn().mockResolvedValue({}),
      execute: executeFn,
      buildResultSummary: jest.fn().mockReturnValue({ id: 'created-id' }),
    };
  };

  const createMockEvaluation = (tier: AgentPolicyTier, overrides: Partial<AgentPolicyEvaluationResult> = {}): AgentPolicyEvaluationResult => ({
    tier,
    reasons: ['test_reason'],
    rule_id: 'rule-1',
    rule_version: 1,
    ...overrides,
  });

  const setupDefaultMocks = () => {
    mockAgentPolicy = { evaluateAction: jest.fn() };
    mockDryRun = { executeInRollbackTransaction: jest.fn() };
    mockAgentActionLog = {
      record: jest.fn(),
      recordInTransaction: jest.fn(
        async (
          _input: unknown,
          _tx: unknown,
          work?: () => Promise<unknown>,
        ) => ({
          traceId: 'trace-123',
          id: 'log-1',
          workResult: work ? await work() : undefined,
        }),
      ),
    };
    mockAgentProposals = {
      persistPendingAction: jest.fn().mockResolvedValue({ id: 'proposal-1' }),
    };
    const tx = {
      tag: 'tx' as const,
      agentProposal: {
        create: jest.fn().mockResolvedValue({ id: 'proposal-1' }),
      },
    };
    mockPrisma = {
      $transaction: jest.fn(async (callback: (innerTx: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    mockCommandIdempotency = {
      beginOrReplay: jest.fn().mockResolvedValue({
        kind: 'execute',
        claim: { receiptId: 'receipt-1', originalTraceId: 'trace-claim' },
      }),
      completeInTransaction: jest.fn().mockResolvedValue(undefined),
      abandon: jest.fn().mockResolvedValue(undefined),
    };
    mockRequestContext = {
      getTraceId: jest.fn().mockReturnValue('trace-claim'),
    };
    mockTenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    };
  };

  beforeEach(async () => {
    setupDefaultMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpWritePipelineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentPolicyService, useValue: mockAgentPolicy },
        { provide: DryRunService, useValue: mockDryRun },
        { provide: AgentActionLogService, useValue: mockAgentActionLog },
        { provide: AgentProposalService, useValue: mockAgentProposals },
        {
          provide: McpWriteCommandIdempotencyService,
          useValue: mockCommandIdempotency,
        },
        { provide: RequestContextService, useValue: mockRequestContext },
        { provide: TenantContextService, useValue: mockTenantContext },
        {
          provide: WorkshopBookingPackageService,
          useValue: { enrichInput: async (input: unknown) => input },
        },
        {
          provide: WorkshopOrderCompletionService,
          useValue: { enrichInput: async (input: unknown) => input },
        },
        {
          provide: InvoiceWorkshopDraftProposeService,
          useValue: { enrichInput: async (input: unknown) => input },
        },
        {
          provide: WorkshopEstimateSendProposeService,
          useValue: { enrichInput: async (input: unknown) => input },
        },
        ...mcpWritePipelineMediaWeeklyTestProviders(),
        {
          provide: MechanicFindingProposeService,
          useValue: {
            enrichInput: async (input: unknown) => input,
            buildProposalPayload: async () => ({
              action_type: 'workshop_order.mechanic_finding',
              payload_json: {},
              preview_json: {},
            }),
          },
        },
      ],
    }).compile();

    service = module.get(McpWritePipelineService);
  });

  describe('propose_line_item tier clamping', () => {
    it('clamps AUTO tier to PROPOSE for propose_line_item', async () => {
      const execution = createMockExecution('propose_line_item');
      const input = { workshop_task_id: 'task-1', workshop_order_id: 'order-1', expected_line_items_version: 1, line_item: { type: 'PART', item_no: 1, description: 'Test', quantity: 1, unit_price_cents: 1000 } };

      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.AUTO));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ op: 'create', entity: 'WorkshopTaskLineItem', id: 'created-id', provisional: true }],
      }));
      mockAgentActionLog.record.mockResolvedValue({ traceId: 'trace-123' } as any);

      const result = await service.run(execution, input, mockContext);

      expect(mockAgentPolicy.evaluateAction).toHaveBeenCalledWith('workshop_order.propose_line', {});
      expect(result.tier).toBe(AgentPolicyTier.PROPOSE);
      expect(result.status).toBe('needs_approval');
      expect(result.pending_action_id).toBe('proposal-1');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result.proposal).toBeDefined();
      expect(mockAgentActionLog.recordInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'AGENT',
          agentId: 'test-agent',
          onBehalfOfUserId: 'test-user',
          actionType: 'mcp.propose_line_item',
          tier: AgentPolicyTier.PROPOSE,
          status: 'PROPOSED',
        }),
        expect.objectContaining({ tag: 'tx' }),
      );
      expect(execution.execute).toHaveBeenCalledTimes(1);
    });

    it('keeps HUMAN_ONLY tier for propose_line_item and refuses', async () => {
      const execution = createMockExecution('propose_line_item');
      const input = { workshop_task_id: 'task-1', workshop_order_id: 'order-1', expected_line_items_version: 1, line_item: { type: 'PART', item_no: 1, description: 'Test', quantity: 1, unit_price_cents: 1000 } };

      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.HUMAN_ONLY));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ op: 'create', entity: 'WorkshopTaskLineItem', id: 'created-id', provisional: true }],
      }));
      mockAgentActionLog.record.mockResolvedValue({ traceId: 'trace-123' } as any);

      const error = await service
        .run(execution, input, mockContext)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'not_permitted',
      });

      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: AgentPolicyTier.HUMAN_ONLY,
          status: 'REFUSED',
        }),
      );
      expect(mockDryRun.executeInRollbackTransaction).not.toHaveBeenCalled();
      expect(execution.execute).not.toHaveBeenCalled();
    });

    it('does not clamp tier for other tools like draft_workshop_order', async () => {
      const execution = createMockExecution('draft_workshop_order');
      const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };

      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.AUTO));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ op: 'create', entity: 'WorkshopOrder', id: 'created-id', provisional: true }],
      }));
      mockAgentActionLog.recordInTransaction.mockImplementation(
        async (_options, _tx, executeFn) => {
          const workResult = await executeFn?.();
          return { traceId: 'trace-123', workResult };
        },
      );

      const result = await service.run(execution, input, mockContext);

      expect(result.tier).toBe(AgentPolicyTier.AUTO);
      expect(result.status).toBe('executed');
      expect(execution.execute).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('call order: policy evaluate → dry-run → execute (AUTO)', () => {
    it('calls policy evaluate, then dry-run, then real execute for AUTO tier', async () => {
      const execution = createMockExecution('draft_workshop_order');
      const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };
      const callOrder: string[] = [];

      mockAgentPolicy.evaluateAction.mockImplementation(async () => {
        callOrder.push('policy-evaluate');
        return createMockEvaluation(AgentPolicyTier.AUTO);
      });

      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => {
        callOrder.push('dry-run-start');
        const result = await fn();
        callOrder.push('dry-run-end');
        return { result, wouldChange: [{ op: 'create', entity: 'WorkshopOrder', id: 'created-id', provisional: true }] };
      });

      mockAgentActionLog.recordInTransaction.mockImplementation(
        async (_options, _tx, executeFn) => {
          callOrder.push('log-record-start');
          const workResult = await executeFn?.();
          callOrder.push('log-record-end');
          return { traceId: 'trace-123', workResult };
        },
      );

      await service.run(execution, input, mockContext);

      expect(callOrder).toEqual([
        'policy-evaluate',
        'dry-run-start',
        'dry-run-end',
        'log-record-start',
        'log-record-end',
      ]);
      expect(execution.execute).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('AUTO tier execution', () => {
    it('executes for real, returns executed status, logs EXECUTED with trace id', async () => {
      const execution = createMockExecution('draft_workshop_order');
      const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };
      const traceId = 'trace-auto-456';

      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.AUTO));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ op: 'create', entity: 'WorkshopOrder', id: 'created-id', provisional: true }],
      }));
      mockAgentActionLog.recordInTransaction.mockImplementation(
        async (_options, _tx, executeFn) => {
          const workResult = await executeFn?.();
          return { traceId, workResult };
        },
      );

      const result = await service.run(execution, input, mockContext);

      expect(result.tier).toBe(AgentPolicyTier.AUTO);
      expect(result.status).toBe('executed');
      expect(result.trace_id).toBe(traceId);
      expect(result.result).toEqual({ id: 'created-id' });
      expect(mockAgentActionLog.recordInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'mcp.draft_workshop_order',
          tier: AgentPolicyTier.AUTO,
          status: 'EXECUTED',
        }),
        expect.objectContaining({ tag: 'tx' }),
        expect.any(Function),
        undefined,
      );
      expect(mockAgentActionLog.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'EXECUTED' }),
        expect.any(Function),
        expect.anything(),
      );
      expect(execution.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('AUTO atomic execute + log', () => {
    it('records FAILED outside the transaction when real execute throws after preview', async () => {
      const execution = createMockExecution('draft_workshop_order');
      const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };
      const domainError = new Error('domain rejected after preview');

      mockAgentPolicy.evaluateAction.mockResolvedValue(
        createMockEvaluation(AgentPolicyTier.AUTO),
      );
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [],
      }));
      execution.execute
        .mockResolvedValueOnce({ id: 'preview-id' })
        .mockRejectedValueOnce(domainError);
      mockAgentActionLog.recordInTransaction.mockImplementation(
        async (_options, _tx, executeFn) => {
          await executeFn?.();
          return { traceId: 'trace-domain-fail', workResult: undefined };
        },
      );
      mockAgentActionLog.record.mockResolvedValue({ traceId: 'trace-failed' } as any);

      await expect(service.run(execution, input, mockContext)).rejects.toBe(
        domainError,
      );

      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          resultSummary: expect.objectContaining({
            error: 'domain rejected after preview',
          }),
        }),
      );
    });

    it('propagates log insert failure and records FAILED without leaving a committed mutation', async () => {
      const execution = createMockExecution('draft_workshop_order');
      const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };
      const logError = new Error('simulated log insert failure');

      mockAgentPolicy.evaluateAction.mockResolvedValue(
        createMockEvaluation(AgentPolicyTier.AUTO),
      );
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [],
      }));
      mockAgentActionLog.recordInTransaction.mockRejectedValue(logError);
      mockAgentActionLog.record.mockResolvedValue({ traceId: 'trace-failed' } as any);

      await expect(service.run(execution, input, mockContext)).rejects.toBe(logError);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          resultSummary: expect.objectContaining({
            error: 'simulated log insert failure',
          }),
        }),
      );
      expect(execution.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('PROPOSE tier (explicit)', () => {
    it('does not execute for real, returns needs_approval, logs PROPOSED with payload', async () => {
      const execution = createMockExecution('draft_workshop_order');
      execution.buildExecutionContext = jest
        .fn()
        .mockResolvedValue({ site_id: 'site-preview' });
      const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };
      const traceId = 'trace-propose-789';

      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.PROPOSE));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ type: 'create', entity: 'WorkshopOrder', entity_id: 'created-id' }],
      }));
      mockAgentActionLog.recordInTransaction.mockResolvedValue({
        traceId,
        id: 'log-propose',
      } as any);

      const result = await service.run(execution, input, mockContext);

      expect(result.tier).toBe(AgentPolicyTier.PROPOSE);
      expect(result.status).toBe('needs_approval');
      expect(result.proposal).toEqual({
        payload: input,
        would_change: [{ type: 'create', entity: 'WorkshopOrder', entity_id: 'created-id' }],
        preview: { id: 'created-id' },
        provisional: true,
      });
      expect(result.trace_id).toBe(traceId);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockAgentActionLog.recordInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'mcp.draft_workshop_order',
          tier: AgentPolicyTier.PROPOSE,
          status: 'PROPOSED',
          resultSummary: expect.objectContaining({
            payload: input,
            would_change: expect.any(Array),
            preview: expect.any(Object),
          }),
        }),
        expect.objectContaining({ tag: 'tx' }),
      );
      expect(execution.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('HUMAN_ONLY tier', () => {
    it('throws ForbiddenException, logs REFUSED, does not execute for real', async () => {
      const execution = createMockExecution('draft_workshop_order');
      const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };
      const traceId = 'trace-human-only-999';

      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.HUMAN_ONLY));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ op: 'create', entity: 'WorkshopOrder', id: 'created-id', provisional: true }],
      }));
      mockAgentActionLog.record.mockResolvedValue({ traceId } as any);

      await expect(service.run(execution, input, mockContext)).rejects.toThrow(ForbiddenException);

      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'mcp.draft_workshop_order',
          tier: AgentPolicyTier.HUMAN_ONLY,
          status: 'REFUSED',
          resultSummary: expect.objectContaining({
            reasons: expect.any(Array),
          }),
        }),
      );
      expect(mockDryRun.executeInRollbackTransaction).not.toHaveBeenCalled();
      expect(execution.execute).not.toHaveBeenCalled();
    });
  });

  it('records a failed action when the rollback preview fails', async () => {
    const execution = createMockExecution('draft_workshop_order');
    const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };
    const failure = new Error('preview rejected');

    mockAgentPolicy.evaluateAction.mockResolvedValue(
      createMockEvaluation(AgentPolicyTier.AUTO),
    );
    mockDryRun.executeInRollbackTransaction.mockRejectedValue(failure);
    mockAgentActionLog.record.mockResolvedValue({ traceId: 'trace-failed' } as any);

    await expect(service.run(execution, input, mockContext)).rejects.toBe(failure);
    expect(mockAgentActionLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'mcp.draft_workshop_order',
        tier: AgentPolicyTier.AUTO,
        status: 'FAILED',
      }),
    );
    expect(execution.execute).toHaveBeenCalledTimes(0);
  });

  describe('output contract (AUT-427)', () => {
    const wouldChange = [
      { entity: 'WorkshopOrder', id: 'order-1', op: 'create' as const, provisional: false },
    ];
    const provisionalChange = [
      { entity: 'WorkshopTaskLineItem', id: 'line-preview', op: 'create' as const, provisional: true },
    ];

    /** Asserts the JSON the handler returns passes the tool's published output schema. */
    function expectOutputMatchesSchema(
      toolName: keyof typeof mcpToolOutputSchemas,
      output: unknown,
    ) {
      const parsed = mcpToolOutputSchemas[toolName].safeParse(toMcpJsonObject(output));
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    }

    it('an executed write matches the output schema of its tool', async () => {
      const execution = createMockExecution('draft_workshop_order');
      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.AUTO));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange,
      }));
      mockAgentActionLog.recordInTransaction.mockImplementation(
        async (_options, _tx, executeFn) => ({
          traceId: 'trace-executed-1',
          workResult: await executeFn?.(),
        }),
      );

      const result = await service.run(
        execution,
        { customer_id: 'cust-1', vehicle_id: 'veh-1' },
        mockContext,
      );

      expect(result.status).toBe('executed');
      expectOutputMatchesSchema('draft_workshop_order', result);
    });

    it('a PROPOSE call matches the output schema of its tool, with a provisional preview', async () => {
      const execution = createMockExecution('propose_line_item');
      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.AUTO));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: provisionalChange,
      }));
      mockAgentActionLog.record.mockResolvedValue({ traceId: 'trace-propose-2' } as any);

      const result = await service.run(
        execution,
        { workshop_order_id: 'order-1', workshop_task_id: 'task-1' },
        mockContext,
      );

      expect(result.tier).toBe(AgentPolicyTier.PROPOSE);
      expect(result.status).toBe('needs_approval');
      expectOutputMatchesSchema('propose_line_item', result);
    });

    it('a refused write is a thrown error with no result body', async () => {
      const execution = createMockExecution('reserve_part');
      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.HUMAN_ONLY));

      await expect(service.run(execution, {}, mockContext)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(execution.execute).not.toHaveBeenCalled();
    });
  });
});
