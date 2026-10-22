import '../workshop/workshop-estimate-send-propose.preview-install.js';
import { AgentPolicyTier, Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { buildRealAdapterServices } from './mcp-write-dry-run.contract.adapters.spec.support.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';
import { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import { WorkshopMediaUploadMcpService } from '../mechanic/workshop-media-upload-mcp.service.js';
import { WeeklyReportMcpService } from '../reports/weekly-report/weekly-report-mcp.service.js';
import { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import { McpWritePipelineService } from './mcp-write-pipeline.service.js';
import type { McpWriteToolResult } from './mcp-write-pipeline.types.js';

const CONTRACT_CUSTOMER = {
  id: '00000000-0000-4000-8000-000000000040',
  tenant_id: 'tenant-1',
  type: 'PRIVATE',
  first_name: 'Max',
  last_name: 'Mustermann',
  company_name: null,
  email: 'max@example.at',
  phone: '+43 664 123456',
  vat_id: null,
  address_street: 'Mustergasse 1',
  address_zip: '1010',
  address_city: 'Wien',
  address_country: 'AT',
  preferred_language: 'de',
  contact_email_ok: true,
};

export type PipelineDryRunFixture = {  service: McpWritePipelineService;
  executors: PendingActionExecutorService;
  mockAgentPolicy: Pick<jest.Mocked<AgentPolicyService>, 'evaluateAction'>;
  mockAgentActionLog: { record: jest.Mock; recordInTransaction: jest.Mock };
  mockPrisma: {
    client: { $transaction: jest.Mock };
    $transaction: jest.Mock;
    mcpWriteCommandReceipt: { create: jest.Mock };
  };
  mockCommandIdempotency: Pick<
    jest.Mocked<McpWriteCommandIdempotencyService>,
    'beginOrReplay' | 'completeInTransaction' | 'abandon'
  >;
  txAgentProposalCreate: jest.Mock;
  mockWorkshopMediaUploadMcp: Pick<
    WorkshopMediaUploadMcpService,
    'createUploadSlot' | 'previewUploadSlot'
  >;
  mockWeeklyReportMcp: Pick<
    WeeklyReportMcpService,
    'preview' | 'execute' | 'refreshReplayResult'
  >;
  mockContext: { agentId: string; onBehalfOfUserId: string };
  executorPrisma: Record<string, unknown>;
  realAdapterSpies: import('./mcp-write-dry-run.contract.adapters.spec.support.js').AdapterLowLevelSpies | null;
  realWorkshopEstimateSendPropose: import('../workshop/workshop-estimate-send-propose.service.js').WorkshopEstimateSendProposeService | null;
};

export async function createPipelineDryRunFixture(options?: {
  useRealAdapters?: boolean;
}): Promise<PipelineDryRunFixture> {
  const txAgentProposalCreate = jest.fn();
  const mockTx = {
    agentProposal: { create: txAgentProposalCreate },
  } as unknown as PrismaTypes.TransactionClient;

  const mockAgentPolicy = {
    evaluateAction: jest.fn().mockResolvedValue({
      tier: AgentPolicyTier.AUTO,
      reasons: ['enabled'],
      rule_id: 'rule-1',
      rule_version: 1,
    }),
  };
  const mockAgentActionLog = {
    record: jest.fn().mockResolvedValue({ traceId: 'trace-dry-run' }),
    recordInTransaction: jest.fn(),
  };
  const mockPrisma = {
    client: {
      $transaction: jest.fn().mockImplementation(async (callback) =>
        callback(mockTx),
      ),
    },
    $transaction: jest.fn(),
    mcpWriteCommandReceipt: { create: jest.fn() },
  };
  const mockCommandIdempotency = {
    beginOrReplay: jest.fn(),
    completeInTransaction: jest.fn(),
    abandon: jest.fn(),
  };

  const realAdapters = options?.useRealAdapters
    ? buildRealAdapterServices()
    : null;

  const mockWorkshopMediaUploadMcp = realAdapters
    ? realAdapters.workshopMediaUploadMcp
    : {
        createUploadSlot: jest.fn(),
        previewUploadSlot: jest.fn().mockResolvedValue({
          dry_run_preview: true,
          workshop_task_id: '00000000-0000-4000-8000-000000000006',
          mime_type: 'image/jpeg',
          size_bytes: 1024,
          media_id: '00000000-0000-4000-8000-00000000d001',
          expires_at: '2026-10-19T12:00:00.000Z',
          upload_url: null,
          fields: {},
        }),
      };
  const mockWeeklyReportMcp = realAdapters
    ? realAdapters.weeklyReportMcp
    : {
        preview: jest.fn().mockResolvedValue({
          site_id: 'site-1',
          period: {
            from: '2026-10-12',
            to: '2026-10-18',
            timezone: 'Europe/Vienna',
            iso_week: '2026-W42',
          },
        }),
        execute: jest.fn(),
        refreshReplayResult: jest.fn((result: McpWriteToolResult) =>
          Promise.resolve(result),
        ),
      };
  const mockMechanicFindingPropose = {
    enrichInput: jest.fn(async (input: unknown) => input),
    buildPreview: jest.fn().mockResolvedValue({
      workshop_task_id: '00000000-0000-4000-8000-000000000006',
      workshop_order_id: '00000000-0000-4000-8000-000000000001',
    }),
    buildProposalPayload: jest.fn(),
    buildExecutionContext: jest.fn().mockResolvedValue({ site_id: 'site-1' }),
    applyAcknowledgment: jest.fn(),
  };

  let executorPrisma: Record<string, unknown> = {
    site: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    workshopOrder: {
      findFirst: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000001',
        line_items_version: 0,
        status: 'IN_PROGRESS',
        tasks: [
          {
            id: '00000000-0000-4000-8000-000000000006',
            line_items_version: 0,
          },
        ],
      }),
    },
    workshopTask: {
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return {
          id: '00000000-0000-4000-8000-000000000006',
          line_items_version: 0,
        };
      }),
      updateMany: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { count: 1 };
      }),
    },
    workshopTaskLineItem: {
      findFirst: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000004',
        catalog_item_id: '00000000-0000-4000-8000-000000000099',
        workshop_task_id: '00000000-0000-4000-8000-000000000006',
        unit_price: new Prisma.Decimal('10.00'),
      }),
      create: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { id: 'line-item-1' };
      }),
    },
    partsReservation: {
      findFirst: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000007',
        quantity: new Prisma.Decimal('1'),
        quantity_consumed: new Prisma.Decimal('0'),
        quantity_returned: new Prisma.Decimal('0'),
        workshop_task_line_item: {
          unit_price: new Prisma.Decimal('10.00'),
        },
      }),
    },
    registrationDocumentIntake: {
      findFirst: jest.fn().mockResolvedValue({ site_id: 'site-1' }),
    },
    workshopMedia: {
      create: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { id: 'media-1' };
      }),
    },
    customer: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(CONTRACT_CUSTOMER),
      create: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return CONTRACT_CUSTOMER;
      }),
      update: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return CONTRACT_CUSTOMER;
      }),
    },
    agentProposal: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };

  if (realAdapters) {
    executorPrisma = realAdapters.enrichExecutorPrisma(executorPrisma);
  }

  const completionService = realAdapters
    ? realAdapters.workshopOrderCompletion
    : ({
        applyCompletion: jest.fn().mockImplementation(async () => {
          expect(DryRunStorage.isDryRun()).toBe(true);
          return { id: 'order-1' };
        }),
        buildExecutionContext: jest.fn().mockResolvedValue({ site_id: 'site-1' }),
        enrichInput: jest.fn(async (input: unknown) => input),
      } as never);

  const estimateSendService = realAdapters
    ? realAdapters.workshopEstimateSendPropose
    : ({
        previewSend: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000030',
          entityId: '00000000-0000-4000-8000-000000000030',
          estimate_version_id: '00000000-0000-4000-8000-000000000030',
          estimate_number: 'EST-1',
          status: 'DRAFT',
          totals: { gross: '120.00', net: '100.00', vat: '20.00' },
        }),
        applySend: jest.fn().mockImplementation(async () => {
          expect(DryRunStorage.isDryRun()).toBe(true);
          return { id: 'ver-1' };
        }),
        buildExecutionContext: jest.fn().mockResolvedValue({ site_id: 'site-1' }),
        buildPolicyContext: jest.fn().mockResolvedValue({ amount_eur: 60 }),
        enrichInput: jest.fn(async (input: unknown) => input),
      } as never);

  const executors = new PendingActionExecutorService(
    executorPrisma as never,
    { getTenantId: jest.fn().mockResolvedValue('tenant-1') } as never,
    { getSiteId: jest.fn().mockResolvedValue('site-1') } as never,
    {
      create: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { id: 'order-1' };
      }),
      createAtSite: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { id: 'order-1' };
      }),
    } as never,
    {
      createOnHandReservation: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { id: 'reservation-1' };
      }),
      releaseReservation: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { id: 'reservation-1' };
      }),
    } as never,
    {
      apply: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { id: '00000000-0000-4000-8000-000000000008' };
      }),
    } as never,
    {
      applyPackage: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { id: 'order-1' };
      }),
      buildExecutionContext: jest.fn().mockResolvedValue({ site_id: 'site-1' }),
      enrichInput: jest.fn(async (input: unknown) => input),
    } as never,
    {
      applyProposedPurchaseOrderDraft: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { id: 'po-1' };
      }),
      buildProposedPurchaseOrderExecutionContext: jest
        .fn()
        .mockResolvedValue({ site_id: 'site-1' }),
    } as never,
    completionService,
    {
      applyDraft: jest.fn().mockImplementation(async () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
        return { id: 'inv-1' };
      }),
      buildExecutionContext: jest.fn().mockResolvedValue({ site_id: 'site-1' }),
      buildPolicyContext: jest.fn().mockResolvedValue({ amount_eur: 120 }),
      enrichInput: jest.fn(async (input: unknown) => input),
    } as never,
    estimateSendService,
    mockWorkshopMediaUploadMcp as never,
    mockMechanicFindingPropose as never,
    mockWeeklyReportMcp as never,
  );

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      McpWritePipelineService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: AgentPolicyService, useValue: mockAgentPolicy },
      DryRunService,
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
        useValue:
          realAdapters?.workshopOrderCompletion ??
          ({ enrichInput: async (input: unknown) => input } as never),
      },
      {
        provide: InvoiceWorkshopDraftProposeService,
        useValue: { enrichInput: async (input: unknown) => input },
      },
      {
        provide: WorkshopEstimateSendProposeService,
        useValue:
          realAdapters?.workshopEstimateSendPropose ??
          ({
            enrichInput: async (input: unknown) => input,
            previewSend: jest.fn().mockResolvedValue({
              id: '00000000-0000-4000-8000-000000000030',
              entityId: '00000000-0000-4000-8000-000000000030',
              estimate_version_id: '00000000-0000-4000-8000-000000000030',
              estimate_number: 'EST-1',
              status: 'DRAFT',
              totals: { gross: '120.00', net: '100.00', vat: '20.00' },
            }),
          } as never),
      },
      {
        provide: MechanicFindingProposeService,
        useValue: mockMechanicFindingPropose,
      },
      {
        provide: WorkshopMediaUploadMcpService,
        useValue: mockWorkshopMediaUploadMcp,
      },
      {
        provide: WeeklyReportMcpService,
        useValue: mockWeeklyReportMcp,
      },
    ],
  }).compile();

  return {
    service: module.get(McpWritePipelineService),
    executors,
    realAdapterSpies: realAdapters?.spies ?? null,
    realWorkshopEstimateSendPropose:
      realAdapters?.workshopEstimateSendPropose ?? null,
    mockAgentPolicy,
    mockAgentActionLog,
    mockPrisma,
    mockCommandIdempotency,
    txAgentProposalCreate,
    mockWorkshopMediaUploadMcp,
    mockWeeklyReportMcp,
    mockContext: {
      agentId: 'contract-agent',
      onBehalfOfUserId: 'contract-user',
    },
    executorPrisma,
  };
}
