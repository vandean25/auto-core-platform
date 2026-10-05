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
    toolName: 'propose_line_item' | 'draft_workshop_order',
  ): McpWriteExecution => {
    const executeFn = jest.fn().mockResolvedValue({ id: 'created-id' });
    return {
      toolName,
      policyActionType: toolName === 'propose_line_item' ? 'workshop_order.propose_line' : 'workshop_order.create',
      buildPolicyContext: jest.fn().mockResolvedValue({}),
      execute: executeFn,
      buildResultSummary: jest.fn().mockReturnValue({ id: 'created-id' }),
    };
  };

  beforeEach(async () => {
    mockAgentPolicy = {
      evaluateAction: jest.fn(),
    } as jest.Mocked<AgentPolicyService>;

    mockDryRun = {
      executeInRollbackTransaction: jest.fn(),
    } as jest.Mocked<DryRunService>;

    mockAgentActionLog = {
      record: jest.fn(),
    } as jest.Mocked<AgentActionLogService>;

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

      const mockEvaluation: AgentPolicyEvaluationResult = {
        tier: AgentPolicyTier.AUTO,
        reasons: ['base_tier_auto'],
        rule_id: 'rule-1',
        rule_version: 1,
      };

      mockAgentPolicy.evaluateAction.mockResolvedValue(mockEvaluation);
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ type: 'create', entity: 'WorkshopTaskLineItem', entity_id: 'created-id' }],
      }));
      mockAgentActionLog.record.mockResolvedValue({
        traceId: 'trace-123',
      } as any);

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
      // execute is called once during dry run, but NOT a second time for real execution
      expect(execution.execute).toHaveBeenCalledTimes(1);
    });

    it('keeps HUMAN_ONLY tier for propose_line_item and refuses', async () => {
      const execution = createMockExecution('propose_line_item');
      const input = { workshop_task_id: 'task-1', workshop_order_id: 'order-1', expected_line_items_version: 1, line_item: { type: 'PART', item_no: 1, description: 'Test', quantity: 1, unit_price_cents: 1000 } };

      const mockEvaluation: AgentPolicyEvaluationResult = {
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['hard_floor_category'],
        rule_id: 'rule-1',
        rule_version: 1,
      };

      mockAgentPolicy.evaluateAction.mockResolvedValue(mockEvaluation);
      mockDryRun.executeInRollbackTransaction.mockImplementation(async (fn) => ({
        result: await fn(),
        wouldChange: [{ type: 'create', entity: 'WorkshopTaskLineItem', entity_id: 'created-id' }],
      }));
      mockAgentActionLog.record.mockResolvedValue({
        traceId: 'trace-123',
      } as any);

      await expect(service.run(execution, input, mockContext)).rejects.toThrow(ForbiddenException);

      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: AgentPolicyTier.HUMAN_ONLY,
          status: 'REFUSED',
        }),
      );
      // execute is called once during dry run, but NOT a second time for real execution
      expect(execution.execute).toHaveBeenCalledTimes(1);
    });

    it('does not clamp tier for other tools like draft_workshop_order', async () => {
      const execution = createMockExecution('draft_workshop_order');
      const input = { customer_id: 'cust-1', vehicle_id: 'veh-1', purpose: 'REPAIR' };

      const mockEvaluation: AgentPolicyEvaluationResult = {
        tier: AgentPolicyTier.AUTO,
        reasons: ['base_tier_auto'],
        rule_id: 'rule-1',
        rule_version: 1,
      };

      mockAgentPolicy.evaluateAction.mockResolvedValue(mockEvaluation);
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
      // execute is called once during dry run, and once more for real execution
      expect(execution.execute).toHaveBeenCalledTimes(2);
    });
  });
});