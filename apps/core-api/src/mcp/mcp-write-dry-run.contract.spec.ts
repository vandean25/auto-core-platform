import { AgentPolicyTier } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DryRunSideEffectBlockedException,
  SideEffectGuard,
} from '../dry-run/side-effect-guard.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';
import { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import {
  McpWritePipelineService,
  type McpWriteExecution,
} from './mcp-write-pipeline.service.js';
import { mcpWriteToolInputSchemas } from './mcp-tool-schemas.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.js';
import { mcpWriteDryRunResultSchema } from './mcp-write-dry-run.schema.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';

describe('MCP write dry_run contract (AUT-612)', () => {
  it('registers dry_run on every write tool input schema', () => {
    for (const toolName of MCP_WRITE_TOOL_NAMES) {
      const parsed = mcpWriteToolInputSchemas[toolName].safeParse({
        dry_run: true,
      });
      if (parsed.success) {
        expect(parsed.data).toMatchObject({ dry_run: true });
        continue;
      }
      const rejectsDryRun = parsed.error.issues.some(
        (issue) =>
          issue.code === 'unrecognized_keys' &&
          'keys' in issue &&
          (issue.keys as string[]).includes('dry_run'),
      );
      expect(rejectsDryRun).toBe(false);
    }
  });

  describe('pipeline dry_run per write tool', () => {
    let service: McpWritePipelineService;
    let mockAgentPolicy: jest.Mocked<AgentPolicyService>;
    let mockDryRun: jest.Mocked<DryRunService>;
    let mockAgentActionLog: jest.Mocked<AgentActionLogService>;
    let mockPrisma: {
      $transaction: jest.Mock;
      mcpWriteCommandReceipt: { create: jest.Mock };
    };
    let mockCommandIdempotency: jest.Mocked<McpWriteCommandIdempotencyService>;
    let txAgentProposalCreate: jest.Mock;

    const mockContext = {
      agentId: 'contract-agent',
      onBehalfOfUserId: 'contract-user',
    };

    beforeEach(async () => {
      mockAgentPolicy = {
        evaluateAction: jest.fn().mockResolvedValue({
          tier: AgentPolicyTier.AUTO,
          reasons: ['enabled'],
          rule_id: 'rule-1',
          rule_version: 1,
        }),
      } as jest.Mocked<AgentPolicyService>;
      mockDryRun = {
        executeInRollbackTransaction: jest.fn().mockResolvedValue({
          result: { id: 'preview-id' },
          wouldChange: [
            {
              entity: 'WorkshopOrder',
              id: 'preview-id',
              op: 'create',
              provisional: true,
            },
          ],
        }),
      } as jest.Mocked<DryRunService>;
      mockAgentActionLog = {
        record: jest.fn().mockResolvedValue({ traceId: 'trace-dry-run' }),
        recordInTransaction: jest.fn(),
      } as jest.Mocked<AgentActionLogService>;
      txAgentProposalCreate = jest.fn();
      mockPrisma = {
        $transaction: jest.fn(),
        mcpWriteCommandReceipt: { create: jest.fn() },
      };
      mockCommandIdempotency = {
        beginOrReplay: jest.fn(),
        completeInTransaction: jest.fn(),
        abandon: jest.fn(),
      } as jest.Mocked<McpWriteCommandIdempotencyService>;
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) =>
          callback({
            agentProposal: { create: txAgentProposalCreate },
          }),
      );

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          McpWritePipelineService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: AgentPolicyService, useValue: mockAgentPolicy },
          { provide: DryRunService, useValue: mockDryRun },
          { provide: AgentActionLogService, useValue: mockAgentActionLog },
          {
            provide: AgentProposalService,
            useValue: { persistPendingAction: jest.fn() },
          },
          {
            provide: McpWriteCommandIdempotencyService,
            useValue: mockCommandIdempotency,
          },
          {
            provide: RequestContextService,
            useValue: { getTraceId: jest.fn().mockReturnValue('trace-claim') },
          },
          {
            provide: TenantContextService,
            useValue: { getTenantId: jest.fn().mockResolvedValue('tenant-1') },
          },
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

    function mockExecution(toolName: (typeof MCP_WRITE_TOOL_NAMES)[number]): McpWriteExecution {
      return {
        toolName,
        policyActionType: `policy.${toolName}`,
        buildPolicyContext: jest.fn().mockResolvedValue({}),
        execute: jest.fn().mockResolvedValue({ id: 'committed-id' }),
        buildResultSummary: jest.fn().mockReturnValue({ id: 'committed-id' }),
      };
    }

    it.each(MCP_WRITE_TOOL_NAMES)(
      '%s: dry_run returns dryRunResult, skips idempotency and commits',
      async (toolName) => {
        const result = await service.run(
          mockExecution(toolName),
          { dry_run: true, command_id: '51500000-0000-4000-8000-000000000601' },
          mockContext,
        );

        expect(result).toMatchObject({ dry_run: true, tool: toolName });
        expect(mcpWriteDryRunResultSchema.safeParse(result).success).toBe(true);
        expect(
          mcpToolOutputSchemas[toolName].safeParse(toMcpJsonObject(result)).success,
        ).toBe(true);
        expect(mockCommandIdempotency.beginOrReplay).not.toHaveBeenCalled();
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
        expect(txAgentProposalCreate).not.toHaveBeenCalled();
        expect(mockAgentActionLog.record).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'DRY_RUN' }),
        );
      },
    );

    it('HUMAN_ONLY dry_run returns policy_decision without preview data', async () => {
      mockAgentPolicy.evaluateAction.mockResolvedValue({
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['policy_disabled'],
        rule_id: 'rule-off',
        rule_version: 1,
      });

      const result = await service.run(
        mockExecution('reserve_part'),
        { dry_run: true },
        mockContext,
      );

      expect(result).toMatchObject({
        dry_run: true,
        would_change: [],
        preview: null,
        policy_decision: {
          tier: 'HUMAN_ONLY',
          reasons: ['policy_disabled'],
        },
      });
      expect(mockDryRun.executeInRollbackTransaction).not.toHaveBeenCalled();
    });
  });

  it('blocks outbound side effects during rollback simulation', () => {
    expect(() =>
      DryRunStorage.run({ isDryRun: true }, () => {
        SideEffectGuard.assertAllowed('GCS_WRITE');
      }),
    ).toThrow(DryRunSideEffectBlockedException);
  });
});
