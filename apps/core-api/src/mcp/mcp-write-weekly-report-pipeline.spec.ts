import { createHash } from 'node:crypto';
import { AgentPolicyTier, Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
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
import { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { WeeklyReportPdfService } from '../reports/weekly-report/weekly-report-pdf.service.js';
import { generateWeeklyReportPdfInputSchema } from '../reports/weekly-report/weekly-report-mcp.schema.js';
import { expectCommitted } from './mcp-write-pipeline.spec.support.js';

describe('McpWritePipelineService generate_weekly_report_pdf', () => {
  let service: McpWritePipelineService;
  let mockDryRun: Pick<
    jest.Mocked<DryRunService>,
    'executeInRollbackTransaction'
  >;
  let mockAgentPolicy: Pick<jest.Mocked<AgentPolicyService>, 'evaluateAction'>;
  let mockAgentActionLog: { record: jest.Mock; recordInTransaction: jest.Mock };
  let mockPrisma: { $transaction: jest.Mock };
  let weeklyReportPdf: WeeklyReportPdfService;
  let storage: {
    deleteExpiredEphemeralWeeklyReports: jest.Mock;
    uploadEphemeralWeeklyReportPdf: jest.Mock;
    createSignedReadUrl: jest.Mock;
  };
  let rateLimit: { assertAllowed: jest.Mock };
  let renderer: { render: jest.Mock };

  const mockContext: McpWriteToolContext = {
    agentId: 'agent-1',
    onBehalfOfUserId: 'user-1',
  };

  const pdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj\n/Type /Page\n2 0 obj\n/Type /Page\n',
  );
  const expectedSha256 = createHash('sha256').update(pdfBuffer).digest('hex');
  const signedUrl = 'https://storage.example/ephemeral-report.pdf';
  const signedExpiresAt = new Date('2026-10-17T13:15:00.000Z');

  const execution = (): McpWriteExecution => ({
    toolName: 'generate_weekly_report_pdf',
    policyActionType: 'report.generate_weekly_pdf',
    buildPolicyContext: () => Promise.resolve({}),
    preview: (input) =>
      weeklyReportPdf.preview(generateWeeklyReportPdfInputSchema.parse(input)),
    execute: (input) =>
      weeklyReportPdf.execute(generateWeeklyReportPdfInputSchema.parse(input)),
    executeOutsideTransaction: true,
    buildResultSummary: (result) => result,
  });

  beforeEach(async () => {
    storage = {
      deleteExpiredEphemeralWeeklyReports: jest.fn().mockResolvedValue(0),
      uploadEphemeralWeeklyReportPdf: jest
        .fn()
        .mockResolvedValue({ bucket: 'pdf-bucket', key: 'ephemeral/k.pdf' }),
      createSignedReadUrl: jest.fn().mockResolvedValue({
        url: signedUrl,
        expiresAt: signedExpiresAt,
      }),
    };
    rateLimit = { assertAllowed: jest.fn().mockResolvedValue(undefined) };
    renderer = { render: jest.fn().mockResolvedValue(pdfBuffer) };

    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN' }),
    };
    const siteContext = {
      getSiteId: jest.fn().mockResolvedValue('site-1'),
      listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
    };
    const prisma = {
      site: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'site-1',
          timezone: 'Europe/Vienna',
        }),
      },
    };
    const data = {
      load: jest.fn().mockResolvedValue({
        period: {
          from: '2026-10-12',
          to: '2026-10-18',
          iso_week: '2026-W42',
          timezone: 'Europe/Vienna',
        },
        site: {
          id: 'site-1',
          name: 'Nord Werkstatt',
          timezone: 'Europe/Vienna',
        },
        revenue: {
          totals: {
            net: new Prisma.Decimal('0'),
            vat: new Prisma.Decimal('0'),
            gross: new Prisma.Decimal('0'),
          },
          by_source: [],
          by_revenue_group: [],
          invoice_count: 0,
        },
        workshop_kpis: {
          totals: {
            utilisation_percent: '0',
            productivity_percent: '0',
            average_net_revenue_per_order: '0',
            closed_orders: 0,
          },
          parts_turnover: { turnover: '1.00' },
        },
        open_estimates: [],
        completed_orders: [],
      }),
    };

    weeklyReportPdf = new WeeklyReportPdfService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
      data as never,
      renderer as never,
      storage as never,
      rateLimit as never,
    );

    mockAgentPolicy = {
      evaluateAction: jest.fn(),
    };
    mockDryRun = {
      executeInRollbackTransaction: jest.fn(),
    };
    mockAgentActionLog = {
      recordInTransaction: jest.fn(),
      record: jest.fn(),
    };
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
        { provide: WorkshopEstimateSendProposeService, useValue: {} },
        { provide: MechanicFindingProposeService, useValue: {} },
      ],
    }).compile();

    service = module.get(McpWritePipelineService);
    mockAgentPolicy.evaluateAction.mockResolvedValue({
      tier: AgentPolicyTier.AUTO,
      reasons: [],
      rule_id: 'rule-1',
      rule_version: 1,
    });
    mockAgentActionLog.recordInTransaction.mockImplementation(
      async (_input, _tx, work) => {
        const workResult = work ? await work() : undefined;
        return { traceId: 'trace-weekly', workResult };
      },
    );
  });

  it('returns execute-derived url, sha256, and page_count through the pipeline', async () => {
    const result = await service.run(
      execution(),
      { iso_week: '2026-W42' },
      mockContext,
    );
    expectCommitted(result);

    expect(mockDryRun.executeInRollbackTransaction).not.toHaveBeenCalled();
    expect(rateLimit.assertAllowed).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(storage.uploadEphemeralWeeklyReportPdf).toHaveBeenCalledTimes(1);
    expect(storage.deleteExpiredEphemeralWeeklyReports).toHaveBeenCalledTimes(1);

    expect(result.status).toBe('executed');
    expect(result.result).toMatchObject({
      url: signedUrl,
      expires_at: signedExpiresAt.toISOString(),
      sha256: expectedSha256,
      page_count: 2,
      period: {
        from: '2026-10-12',
        to: '2026-10-18',
        timezone: 'Europe/Vienna',
        iso_week: '2026-W42',
      },
    });

    const parsed = mcpToolOutputSchemas.generate_weekly_report_pdf.safeParse(
      toMcpJsonObject(result),
    );
    expect(parsed.success).toBe(true);
  });
});
