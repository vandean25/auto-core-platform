import { AgentPolicyTier } from '@prisma/client';
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
import {
  McpWritePipelineService,
  type McpWriteExecution,
  type McpWriteToolContext,
} from './mcp-write-pipeline.service.js';
import { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.js';
import { toMcpJsonObject } from './mcp-output.util.js';

describe('McpWritePipelineService generate_weekly_report_pdf', () => {
  let service: McpWritePipelineService;
  let mockDryRun: jest.Mocked<DryRunService>;
  let mockAgentPolicy: jest.Mocked<AgentPolicyService>;
  let mockAgentActionLog: jest.Mocked<AgentActionLogService>;
  let mockPrisma: { $transaction: jest.Mock };
  let executeFn: jest.Mock;
  let previewFn: jest.Mock;

  const mockContext: McpWriteToolContext = {
    agentId: 'agent-1',
    onBehalfOfUserId: 'user-1',
  };

  const executedPayload = {
    id: 'report-uuid',
    site_id: 'site-1',
    url: 'https://storage.example/report.pdf',
    expires_at: '2026-10-17T13:00:00.000Z',
    sha256: 'a'.repeat(64),
    page_count: 2,
    period: {
      from: '2026-10-12',
      to: '2026-10-18',
      timezone: 'Europe/Vienna',
      iso_week: '2026-W42',
    },
    storage_bucket: 'pdf-bucket',
    storage_key: 'ephemeral/weekly-reports/tenant-1/report-uuid.pdf',
    object_expires_at: '2026-10-18T13:00:00.000Z',
  };

  const execution = (): McpWriteExecution => ({
    toolName: 'generate_weekly_report_pdf',
    policyActionType: 'report.generate_weekly_pdf',
    buildPolicyContext: () => Promise.resolve({}),
    preview: previewFn,
    execute: executeFn,
    executeOutsideTransaction: true,
    buildResultSummary: (result) => result,
  });

  beforeEach(async () => {
    previewFn = jest.fn().mockResolvedValue({
      site_id: 'site-1',
      period: executedPayload.period,
    });
    executeFn = jest.fn().mockResolvedValue(executedPayload);

    mockAgentPolicy = {
      evaluateAction: jest.fn(),
    } as jest.Mocked<AgentPolicyService>;
    mockDryRun = {
      executeInRollbackTransaction: jest.fn(),
    } as jest.Mocked<DryRunService>;
    mockAgentActionLog = {
      recordInTransaction: jest.fn(),
      record: jest.fn(),
    } as jest.Mocked<AgentActionLogService>;
    mockPrisma = {
      $transaction: jest.fn((fn) =>
        fn({ tag: 'tx', agentActionLog: { create: jest.fn() } }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpWritePipelineService,
        { provide: AgentPolicyService, useValue: mockAgentPolicy },
        { provide: DryRunService, useValue: mockDryRun },
        { provide: AgentActionLogService, useValue: mockAgentActionLog },
        { provide: AgentProposalService, useValue: {} },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: McpWriteCommandIdempotencyService,
          useValue: { beginOrReplay: jest.fn(), completeInTransaction: jest.fn() },
        },
        { provide: RequestContextService, useValue: { getTraceId: () => 'trace-1' } },
        { provide: TenantContextService, useValue: {} },
        { provide: WorkshopBookingPackageService, useValue: {} },
        { provide: WorkshopOrderCompletionService, useValue: {} },
        { provide: InvoiceWorkshopDraftProposeService, useValue: {} },
        { provide: MechanicFindingProposeService, useValue: {} },
      ],
    }).compile();

    service = module.get(McpWritePipelineService);
    mockAgentPolicy.evaluateAction.mockResolvedValue({
      tier: AgentPolicyTier.AUTO,
      reasons: [],
    } as AgentPolicyEvaluationResult);
    mockAgentActionLog.recordInTransaction.mockResolvedValue({
      traceId: 'trace-weekly',
      workResult: executedPayload,
    } as never);
  });

  it('runs preview without dry-run execute and executes outside the log transaction', async () => {
    const result = await service.run(
      execution(),
      { iso_week: '2026-W42' },
      mockContext,
    );

    expect(previewFn).toHaveBeenCalledTimes(1);
    expect(mockDryRun.executeInRollbackTransaction).not.toHaveBeenCalled();
    expect(executeFn).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('executed');
    expect(result.result).toMatchObject({
      url: executedPayload.url,
      sha256: executedPayload.sha256,
      page_count: executedPayload.page_count,
      period: executedPayload.period,
    });

    const parsed = mcpToolOutputSchemas.generate_weekly_report_pdf.safeParse(
      toMcpJsonObject(result),
    );
    expect(parsed.success).toBe(true);
  });
});
