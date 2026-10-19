import { AgentPolicyTier } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
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
import {
  MCP_WRITE_TOOL_NAMES,
  type McpWriteToolName,
} from './mcp.constants.js';
import { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import {
  McpWritePipelineService,
  type McpWriteExecution,
} from './mcp-write-pipeline.service.js';
import { mcpWriteToolInputSchemas } from './mcp-tool-schemas.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.registry.js';
import { mcpWriteDryRunResultSchema } from './mcp-write-dry-run.schema.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { MCP_REGISTERED_TOOL_INPUT_SCHEMAS } from './mcp-server.factory.js';
import { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';
import { z } from 'zod';

import type { PendingActionType } from '../pending-action-executor/pending-action-executor.types.js';

const ACTION_TYPE_BY_WRITE_TOOL: Record<McpWriteToolName, PendingActionType> = {
  draft_workshop_order: 'workshop_order.create',
  reserve_part: 'inventory.part_reserve',
  release_reservation: 'inventory.part_release',
  propose_line_item: 'workshop_order.propose_line',
  propose_registration_intake: 'registration_intake.apply',
  propose_workshop_booking: 'workshop.booking_package',
  propose_purchase_order: 'purchase_order.propose_draft',
  propose_workshop_order_completion: 'workshop_order.complete',
  propose_invoice_draft_from_order: 'invoice.create_draft_from_workshop_order',
  propose_estimate_send: 'workshop_estimate.send',
  request_workshop_media_upload: 'workshop.media_upload_slot',
  propose_mechanic_finding: 'workshop_order.propose_mechanic_finding',
  generate_weekly_report_pdf: 'report.generate_weekly_pdf',
};

function buildWriteExecution(
  toolName: McpWriteToolName,
  executors: PendingActionExecutorService,
): McpWriteExecution {
  const executor = executors.resolve(ACTION_TYPE_BY_WRITE_TOOL[toolName]);
  const policyActionType =
    toolName === 'propose_estimate_send'
      ? 'estimate.send_customer_message'
      : executor.actionType;
  return {
    toolName,
    policyActionType,
    buildPolicyContext: (input) => executor.buildPolicyContext(input),
    buildExecutionContext: executor.buildExecutionContext
      ? (input) => executor.buildExecutionContext!(input)
      : undefined,
    preview: executor.preview
      ? (input, executionContext) =>
          executor.preview!(input, executionContext)
      : undefined,
    execute: (input, executionContext) =>
      executor.execute(input, executionContext),
    executeOutsideTransaction: executor.executeOutsideTransaction ?? false,
    refreshReplayResult: executor.refreshReplayResult
      ? (result) => executor.refreshReplayResult!(result)
      : undefined,
    buildResultSummary: (result) => executor.buildResultSummary(result),
    buildLogMetadata: executor.buildLogMetadata
      ? (result) => executor.buildLogMetadata!(result)
      : undefined,
  };
}

function parseRegisteredInput(toolName: McpWriteToolName, raw: unknown) {
  const schema = MCP_REGISTERED_TOOL_INPUT_SCHEMAS[toolName];
  if (schema instanceof z.ZodType) {
    return schema.parse(raw);
  }
  return z.object(schema).strict().parse(raw);
}

const DRY_RUN_MINIMAL_INPUTS: Partial<
  Record<McpWriteToolName, Record<string, unknown>>
> = {
  draft_workshop_order: {
    vehicle_id: '00000000-0000-4000-8000-000000000002',
    status: 'SCHEDULED',
    bay_id: '00000000-0000-4000-8000-000000000003',
    scheduled_start_at: '2026-10-20T08:00:00Z',
    scheduled_end_at: '2026-10-20T09:00:00Z',
  },
  reserve_part: {
    workshop_task_line_item_id: '00000000-0000-4000-8000-000000000004',
    quantity: 1,
    location_id: '00000000-0000-4000-8000-000000000005',
  },
  release_reservation: {
    reservation_id: '00000000-0000-4000-8000-000000000007',
  },
  propose_line_item: {
    workshop_order_id: '00000000-0000-4000-8000-000000000001',
    workshop_task_id: '00000000-0000-4000-8000-000000000006',
    expected_line_items_version: 0,
    line_item: {
      type: 'FEE',
      item_no: 'FEE-1',
      description: 'Test fee',
      quantity: 1,
      unit_price_cents: 100,
    },
  },
  propose_registration_intake: {
    intake_id: '00000000-0000-4000-8000-000000000008',
    vin: null,
    plate: 'W-12345',
    holder: { first_name: 'A', last_name: 'B' },
    nationalcode: null,
    first_registration: null,
  },
  propose_workshop_booking: {
    customer_id: '00000000-0000-4000-8000-000000000020',
    vehicle_id: '00000000-0000-4000-8000-000000000002',
    bay_id: '00000000-0000-4000-8000-000000000003',
    scheduled_start_at: '2026-10-20T08:00:00.000Z',
    scheduled_end_at: '2026-10-20T09:00:00.000Z',
  },
  propose_purchase_order: {
    vendor_id: '00000000-0000-4000-8000-000000000010',
    requisition_id: '00000000-0000-4000-8000-000000000011',
    lines: [
      {
        reservation_id: '00000000-0000-4000-8000-000000000012',
        catalog_item_id: '00000000-0000-4000-8000-000000000013',
        cost_basis: { version: 1, unit_cost_net: '10.00' },
      },
    ],
  },
  propose_workshop_order_completion: {
    workshop_order_id: '00000000-0000-4000-8000-000000000001',
  },
  propose_invoice_draft_from_order: {
    workshop_order_id: '00000000-0000-4000-8000-000000000001',
  },
  propose_estimate_send: {
    workshop_order_id: '00000000-0000-4000-8000-000000000001',
    channel: 'email',
  },
  request_workshop_media_upload: {
    workshop_task_id: '00000000-0000-4000-8000-000000000006',
    mime_type: 'image/jpeg',
    size_bytes: 1024,
    purpose: 'MECHANIC_FINDING',
  },
  propose_mechanic_finding: {
    workshop_order_id: '00000000-0000-4000-8000-000000000001',
    workshop_task_id: '00000000-0000-4000-8000-000000000006',
    description: 'Dry run finding',
  },
  generate_weekly_report_pdf: { iso_week: '2026-W42' },
};

describe('MCP write dry_run contract (AUT-612)', () => {
  it('registers dry_run on every write tool input schema exposed by the MCP server', () => {
    for (const toolName of MCP_WRITE_TOOL_NAMES) {
      const minimal = DRY_RUN_MINIMAL_INPUTS[toolName] ?? {};
      const parsed = parseRegisteredInput(toolName, {
        ...minimal,
        dry_run: true,
      });
      expect(parsed).toMatchObject({ dry_run: true });
      expect(() =>
        parseRegisteredInput(toolName, {
          ...minimal,
          dry_run: true,
          definitely_not_a_field: 1,
        }),
      ).toThrow(/unrecognized/i);
      expect(
        mcpWriteToolInputSchemas[toolName].parse({ ...minimal, dry_run: true }),
      ).toEqual(parsed);
    }
  });

  describe('pipeline dry_run per write tool (real executors)', () => {
    const mockWorkshopMediaUploadMcp = {
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
    const mockWeeklyReportMcp = {
      preview: jest.fn().mockResolvedValue({
        site_id: 'site-1',
        period: { from: '2026-10-12', to: '2026-10-18', timezone: 'Europe/Vienna', iso_week: '2026-W42' },
      }),
      execute: jest.fn(),
      refreshReplayResult: jest.fn((result: unknown) => Promise.resolve(result)),
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

    let service: McpWritePipelineService;
    let executors: PendingActionExecutorService;
    let mockAgentPolicy: jest.Mocked<AgentPolicyService>;
    let mockAgentActionLog: jest.Mocked<AgentActionLogService>;
    let mockPrisma: {
      client: { $transaction: jest.Mock };
      $transaction: jest.Mock;
      mcpWriteCommandReceipt: { create: jest.Mock };
    };
    let mockCommandIdempotency: jest.Mocked<McpWriteCommandIdempotencyService>;
    let txAgentProposalCreate: jest.Mock;
    let mockTx: PrismaTypes.TransactionClient;

    const mockContext = {
      agentId: 'contract-agent',
      onBehalfOfUserId: 'contract-user',
    };

    beforeEach(async () => {
      txAgentProposalCreate = jest.fn();
      mockTx = {
        agentProposal: { create: txAgentProposalCreate },
      } as unknown as Prisma.TransactionClient;

      mockAgentPolicy = {
        evaluateAction: jest.fn().mockResolvedValue({
          tier: AgentPolicyTier.AUTO,
          reasons: ['enabled'],
          rule_id: 'rule-1',
          rule_version: 1,
        }),
      } as jest.Mocked<AgentPolicyService>;
      mockAgentActionLog = {
        record: jest.fn().mockResolvedValue({ traceId: 'trace-dry-run' }),
        recordInTransaction: jest.fn(),
      } as jest.Mocked<AgentActionLogService>;
      mockPrisma = {
        client: {
          $transaction: jest.fn().mockImplementation(async (callback) =>
            callback(mockTx),
          ),
        },
        $transaction: jest.fn(),
        mcpWriteCommandReceipt: { create: jest.fn() },
      };
      mockCommandIdempotency = {
        beginOrReplay: jest.fn(),
        completeInTransaction: jest.fn(),
        abandon: jest.fn(),
      } as jest.Mocked<McpWriteCommandIdempotencyService>;

      const executorPrisma = {
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
          create: jest.fn().mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000006',
            line_items_version: 0,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workshopTaskLineItem: {
          findFirst: jest.fn().mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000004',
            catalog_item_id: '00000000-0000-4000-8000-000000000099',
            workshop_task_id: '00000000-0000-4000-8000-000000000006',
            unit_price: new Prisma.Decimal('10.00'),
          }),
          create: jest.fn().mockResolvedValue({ id: 'line-item-1' }),
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
        workshopMedia: { create: jest.fn() },
      };

      executors = new PendingActionExecutorService(
        executorPrisma as never,
        { getTenantId: jest.fn().mockResolvedValue('tenant-1') } as never,
        { getSiteId: jest.fn().mockResolvedValue('site-1') } as never,
        {
          create: jest.fn().mockResolvedValue({ id: 'order-1' }),
          createAtSite: jest.fn().mockResolvedValue({ id: 'order-1' }),
        } as never,
        {
          createOnHandReservation: jest
            .fn()
            .mockResolvedValue({ id: 'reservation-1' }),
          releaseReservation: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
        } as never,
        {
          apply: jest.fn().mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000008',
          }),
        } as never,
        {
          applyPackage: jest.fn().mockResolvedValue({ id: 'order-1' }),
          buildExecutionContext: jest.fn().mockResolvedValue({ site_id: 'site-1' }),
          enrichInput: jest.fn(async (input: unknown) => input),
        } as never,
        {
          applyProposedPurchaseOrderDraft: jest.fn().mockResolvedValue({ id: 'po-1' }),
          buildProposedPurchaseOrderExecutionContext: jest
            .fn()
            .mockResolvedValue({ site_id: 'site-1' }),
        } as never,
        {
          applyCompletion: jest.fn().mockResolvedValue({ id: 'order-1' }),
          buildExecutionContext: jest.fn().mockResolvedValue({ site_id: 'site-1' }),
          enrichInput: jest.fn(async (input: unknown) => input),
        } as never,
        {
          applyDraft: jest.fn().mockResolvedValue({ id: 'inv-1' }),
          buildExecutionContext: jest.fn().mockResolvedValue({ site_id: 'site-1' }),
          buildPolicyContext: jest.fn().mockResolvedValue({ amount_eur: 120 }),
          enrichInput: jest.fn(async (input: unknown) => input),
        } as never,
        {
          applySend: jest.fn().mockResolvedValue({ id: 'ver-1' }),
          buildExecutionContext: jest.fn().mockResolvedValue({ site_id: 'site-1' }),
          buildPolicyContext: jest.fn().mockResolvedValue({ amount_eur: 60 }),
          enrichInput: jest.fn(async (input: unknown) => input),
        } as never,
        mockWorkshopMediaUploadMcp as never,
        mockMechanicFindingPropose as never,
        mockWeeklyReportMcp as never,
        {},
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
            useValue: mockMechanicFindingPropose,
          },
        ],
      }).compile();

      service = module.get(McpWritePipelineService);
    });

    it.each(MCP_WRITE_TOOL_NAMES)(
      '%s: dry_run uses executor, skips idempotency and commits',
      async (toolName) => {
        const execution = buildWriteExecution(toolName, executors);
        const businessInput = DRY_RUN_MINIMAL_INPUTS[toolName] ?? {};
        const result = await service.run(
          execution,
          {
            dry_run: true,
            command_id: '51500000-0000-4000-8000-000000000601',
            ...businessInput,
          },
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
        expect(mockPrisma.mcpWriteCommandReceipt.create).not.toHaveBeenCalled();
        expect(mockAgentActionLog.record).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'DRY_RUN' }),
        );
      },
    );

    it('request_workshop_media_upload dry_run does not mint upload credentials', async () => {
      const execution = buildWriteExecution(
        'request_workshop_media_upload',
        executors,
      );
      const result = await service.run(
        execution,
        {
          dry_run: true,
          workshop_task_id: '00000000-0000-4000-8000-000000000006',
          mime_type: 'image/jpeg',
          size_bytes: 1024,
          purpose: 'MECHANIC_FINDING',
        },
        mockContext,
      );

      expect(mockWorkshopMediaUploadMcp.previewUploadSlot).toHaveBeenCalled();
      expect(mockWorkshopMediaUploadMcp.createUploadSlot).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        dry_run: true,
        preview: expect.objectContaining({
          dry_run_preview: true,
          upload_url: null,
          fields: {},
        }),
      });
    });

    it('HUMAN_ONLY dry_run returns policy_decision without preview data', async () => {
      mockAgentPolicy.evaluateAction.mockResolvedValue({
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['policy_disabled'],
        rule_id: 'rule-off',
        rule_version: 1,
      });

      const result = await service.run(
        buildWriteExecution('reserve_part', executors),
        {
          dry_run: true,
          workshop_task_line_item_id: '00000000-0000-4000-8000-000000000004',
          quantity: 1,
          location_id: '00000000-0000-4000-8000-000000000005',
        },
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
