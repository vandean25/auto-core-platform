import { AgentPolicyTier } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { AgentPolicyEvaluationResult } from '../agent-policy/agent-policy.types.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import { McpWritePipelineService } from './mcp-write-pipeline.service.js';
import type { McpWriteExecution, McpWriteToolContext } from './mcp-write-pipeline.service.js';

describe('McpWritePipelineService', () => {
  let service: McpWritePipelineService;
  let mockAgentPolicy: jest.Mocked<AgentPolicyService>;
  let mockDryRun: jest.Mocked<DryRunService>;
  let mockAgentActionLog: jest.Mocked<AgentActionLogService>;

  const mockContext: McpWriteToolContext = {
    agentId: 'test-agent',
    onBehalfOfUserId: 'test-user',
  };

  const createMockExecution = (
    toolName: 'propose_line_item' | 'draft_workshop_order' | 'reserve_part' | 'release_reservation',
  ): McpWriteExecution => {
    const executeFn = jest.fn().mockResolvedValue({ id: 'created-id' });
    const policyActionMap: Record<string, string> = {
      propose_line_item: 'workshop_order.propose_line',
      draft_workshop_order: 'workshop_order.create',
      reserve_part: 'workshop_task.reserve_part',
      release_reservation: 'workshop_task.release_reservation',
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
    mockAgentPolicy = { evaluateAction: jest.fn() } as jest.Mocked<AgentPolicyService>;
    mockDryRun = { executeInRollbackTransaction: jest.fn() } as jest.Mocked<DryRunService>;
    mockAgentActionLog = { record: jest.fn() } as jest.Mocked<AgentActionLogService>;
  };

  beforeEach(async () => {
    setupDefaultMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpWritePipelineService,
        { provide: AgentPolicyService, useValue: mockAgentPolicy },
        { provide: DryRunService, useValue: mockDryRun },
        { provide: AgentActionLogService, useValue: mockAgentActionLog },
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
        wouldChange: [{ type: 'create', entity: 'WorkshopTaskLineItem', entity_id: 'created-id' }],
      }));
      mockAgentActionLog.record.mockResolvedValue({ traceId: 'trace-123' } as any);

      const result = await service.run(execution, input, mockContext);

      expect(mockAgentPolicy.evaluateAction).toHaveBeenCalledWith('workshop_order.propose_line', {});
      expect(result.tier).toBe(AgentPolicyTier.PROPOSE);
      expect(result.status).toBe('needs_human_approval');
      expect(result.proposal).toBeDefined();
      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'AGENT',
          agentId: 'test-agent',
          onBehalfOfUserId: 'test-user',
          actionType: 'mcp.propose_line_item',
          tier: AgentPolicyTier.PROPOSE,
          status: 'PROPOSED',
        }),
      );
      expect(execution.execute).toHaveBeenCalledTimes(1);
    });

    it('keeps HUMAN_ONLY tier for propose_line_item and refuses', async () => {
      const execution = createMockExecution('propose_line_item');
      const input = { workshop_task_id: 'task-1', workshop_order_id: 'order-1', expected_line_items_version: 1, line_item: { type: 'PART', item_no: 1, description: 'Test', quantity: 1, unit_price_cents: 1000 } };

      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.HUMAN_ONLY));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ type: 'create', entity: 'WorkshopTaskLineItem', entity_id: 'created-id' }],
      }));
      mockAgentActionLog.record.mockResolvedValue({ traceId: 'trace-123' } as any);

      await expect(service.run(execution, input, mockContext)).rejects.toThrow(ForbiddenException);

      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: AgentPolicyTier.HUMAN_ONLY,
          status: 'REFUSED',
        }),
      );
      expect(execution.execute).toHaveBeenCalledTimes(1);
    });

    it('does not clamp tier for other tools like draft_workshop_order', async () => {
      const execution = createMockExecution('draft_workshop_order');
      const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };

      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.AUTO));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ type: 'create', entity: 'WorkshopOrder', entity_id: 'created-id' }],
      }));
      mockAgentActionLog.record.mockImplementation(async (_options, executeFn) => {
        const workResult = await executeFn();
        return { traceId: 'trace-123', workResult };
      });

      const result = await service.run(execution, input, mockContext);

      expect(result.tier).toBe(AgentPolicyTier.AUTO);
      expect(result.status).toBe('executed');
      expect(execution.execute).toHaveBeenCalledTimes(2);
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
        return { result, wouldChange: [{ type: 'create', entity: 'WorkshopOrder', entity_id: 'created-id' }] };
      });

      mockAgentActionLog.record.mockImplementation(async (options, executeFn) => {
        callOrder.push('log-record-start');
        const workResult = await executeFn();
        callOrder.push('log-record-end');
        return { traceId: 'trace-123', workResult };
      });

      await service.run(execution, input, mockContext);

      expect(callOrder).toEqual([
        'policy-evaluate',
        'dry-run-start',
        'dry-run-end',
        'log-record-start',
        'log-record-end',
      ]);
      expect(execution.execute).toHaveBeenCalledTimes(2);
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
        wouldChange: [{ type: 'create', entity: 'WorkshopOrder', entity_id: 'created-id' }],
      }));
      mockAgentActionLog.record.mockImplementation(async (options, executeFn) => {
        const workResult = await executeFn();
        return { traceId, workResult };
      });

      const result = await service.run(execution, input, mockContext);

      expect(result.tier).toBe(AgentPolicyTier.AUTO);
      expect(result.status).toBe('executed');
      expect(result.trace_id).toBe(traceId);
      expect(result.result).toEqual({ id: 'created-id' });
      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'mcp.draft_workshop_order',
          tier: AgentPolicyTier.AUTO,
          status: 'EXECUTED',
        }),
        expect.any(Function),
      );
      expect(execution.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('PROPOSE tier (explicit)', () => {
    it('does not execute for real, returns needs_human_approval, logs PROPOSED with payload', async () => {
      const execution = createMockExecution('draft_workshop_order');
      const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };
      const traceId = 'trace-propose-789';

      mockAgentPolicy.evaluateAction.mockResolvedValue(createMockEvaluation(AgentPolicyTier.PROPOSE));
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ type: 'create', entity: 'WorkshopOrder', entity_id: 'created-id' }],
      }));
      mockAgentActionLog.record.mockResolvedValue({ traceId } as any);

      const result = await service.run(execution, input, mockContext);

      expect(result.tier).toBe(AgentPolicyTier.PROPOSE);
      expect(result.status).toBe('needs_human_approval');
      expect(result.proposal).toEqual({
        payload: input,
        would_change: [{ type: 'create', entity: 'WorkshopOrder', entity_id: 'created-id' }],
        preview: { id: 'created-id' },
      });
      expect(result.trace_id).toBe(traceId);
      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
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
        wouldChange: [{ type: 'create', entity: 'WorkshopOrder', entity_id: 'created-id' }],
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
            would_change: expect.any(Array),
          }),
        }),
      );
      expect(execution.execute).toHaveBeenCalledTimes(1);
    });
  });
});