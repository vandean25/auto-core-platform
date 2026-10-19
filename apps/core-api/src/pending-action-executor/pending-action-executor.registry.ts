import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import { RegistrationIntakeApplyService } from '../registration-intake/registration-intake-apply.service.js';
import { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import { PurchaseService } from '../purchase/purchase.service.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import { WorkshopMediaUploadMcpService } from '../mechanic/workshop-media-upload-mcp.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import { WeeklyReportMcpService } from '../reports/weekly-report/weekly-report-mcp.service.js';
import type {
  PendingActionExecutor,
  PendingActionType,
} from './pending-action-executor.types.js';
import {
  addLineItem,
  addProposedLineItem,
  proposeLinePolicyContext,
} from './pending-action-executor.line-item.js';
import {
  applyRegistrationIntake,
  createWorkshopMediaUploadSlot,
  previewWorkshopMediaUploadSlot,
  createWorkshopOrder,
  executeDocumentSortProposal,
  executeImportRowMatchProposal,
  generateWeeklyReportPdf,
  previewWeeklyReportPdf,
  purchaseOrderProposePolicyContext,
  registrationIntakeExecutionContext,
  releasePolicyContext,
  releaseReservation,
  reservePart,
  reservePolicyContext,
  updateCustomer,
  type PendingActionHandlerDeps,
} from './pending-action-executor.handlers.js';
import { asRecord } from './pending-action-executor.util.js';

export type PendingActionRegistryDeps = PendingActionHandlerDeps & {
  workshopBookingPackage: WorkshopBookingPackageService;
  purchaseService: PurchaseService;
  workshopOrderCompletion: WorkshopOrderCompletionService;
  invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService;
  workshopEstimateSendPropose: WorkshopEstimateSendProposeService;
  mechanicFindingPropose: MechanicFindingProposeService;
};

const lineItemDeps = (deps: PendingActionRegistryDeps) => ({
  prisma: deps.prisma,
  tenantContext: deps.tenantContext,
  siteContext: deps.siteContext,
});

function buildExecutor(
  deps: PendingActionRegistryDeps,
  actionType: PendingActionType,
): PendingActionExecutor {
  const factory = EXECUTOR_FACTORIES[actionType];
  if (!factory) {
    throw new Error(`Missing executor factory for ${actionType}`);
  }
  return factory(deps, actionType);
}

/** Resolves a pending action without dynamic property access on user input (CodeQL). */
export function resolvePendingActionExecutor(
  deps: PendingActionRegistryDeps,
  actionType: string,
): PendingActionExecutor {
  switch (actionType) {
    case 'workshop_order.create':
      return buildExecutor(deps, 'workshop_order.create');
    case 'workshop_task.reserve_part':
      return buildExecutor(deps, 'workshop_task.reserve_part');
    case 'inventory.part_reserve':
      return buildExecutor(deps, 'inventory.part_reserve');
    case 'workshop_task.release_reservation':
      return buildExecutor(deps, 'workshop_task.release_reservation');
    case 'inventory.part_release':
      return buildExecutor(deps, 'inventory.part_release');
    case 'workshop_order.propose_line':
      return buildExecutor(deps, 'workshop_order.propose_line');
    case 'workshop_order.mechanic_finding':
      return buildExecutor(deps, 'workshop_order.mechanic_finding');
    case 'workshop_order.propose_mechanic_finding':
      return buildExecutor(deps, 'workshop_order.propose_mechanic_finding');
    case 'workshop.media_upload_slot':
      return buildExecutor(deps, 'workshop.media_upload_slot');
    case 'report.generate_weekly_pdf':
      return buildExecutor(deps, 'report.generate_weekly_pdf');
    case 'workshop_order.add_line':
      return buildExecutor(deps, 'workshop_order.add_line');
    case 'customer.update':
      return buildExecutor(deps, 'customer.update');
    case 'decision.import_row_match':
      return buildExecutor(deps, 'decision.import_row_match');
    case 'decision.document_sort':
      return buildExecutor(deps, 'decision.document_sort');
    case 'registration_intake.apply':
      return buildExecutor(deps, 'registration_intake.apply');
    case 'workshop.booking_package':
      return buildExecutor(deps, 'workshop.booking_package');
    case 'purchase_order.propose_draft':
      return buildExecutor(deps, 'purchase_order.propose_draft');
    case 'workshop_order.complete':
      return buildExecutor(deps, 'workshop_order.complete');
    case 'invoice.create_draft_from_workshop_order':
      return buildExecutor(deps, 'invoice.create_draft_from_workshop_order');
    case 'workshop_estimate.send':
      return buildExecutor(deps, 'workshop_estimate.send');
    case 'estimate.send_customer_message':
      return buildExecutor(deps, 'estimate.send_customer_message');
    default:
      throw new BadRequestException(
        `Unsupported action type for automatic execution: ${actionType}`,
      );
  }
}

type ExecutorFactory = (
  deps: PendingActionRegistryDeps,
  actionType: PendingActionType,
) => PendingActionExecutor;

const EXECUTOR_FACTORIES: Partial<Record<PendingActionType, ExecutorFactory>> =
  {
    'workshop_order.create': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      buildExecutionContext: async () => ({
        site_id: await deps.siteContext.getSiteId(),
      }),
      execute: (input, context) => createWorkshopOrder(deps, input, context),
      buildResultSummary: (result) => ({
        workshop_order_id: (result as { id: string }).id,
      }),
      buildLogMetadata: (result) => ({
        entityType: 'WorkshopOrder',
        entityId: (result as { id: string }).id,
        reversible: true,
      }),
    }),
    'workshop_task.reserve_part': reservePartExecutor,
    'inventory.part_reserve': reservePartExecutor,
    'workshop_task.release_reservation': releasePartExecutor,
    'inventory.part_release': releasePartExecutor,
    'workshop_order.propose_line': (deps, actionType) => ({
      actionType,
      buildPolicyContext: (input) =>
        Promise.resolve(proposeLinePolicyContext(input)),
      execute: (input) => addProposedLineItem(lineItemDeps(deps), input),
      buildResultSummary: (result) => ({
        line_item_id: (result as { id: string }).id,
      }),
    }),
    'workshop_order.mechanic_finding': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      buildExecutionContext: async (input) => {
        const record = asRecord(input);
        const siteId =
          typeof record.site_id === 'string'
            ? record.site_id
            : await deps.siteContext.getSiteId();
        return { site_id: siteId };
      },
      execute: (input, executionContext) =>
        deps.mechanicFindingPropose.applyAcknowledgment(
          input,
          executionContext,
        ),
      buildResultSummary: (result) => ({
        workshop_task_id: (result as { workshop_task_id: string })
          .workshop_task_id,
        workshop_order_id: (result as { workshop_order_id: string })
          .workshop_order_id,
      }),
    }),
    'workshop_order.propose_mechanic_finding': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      buildExecutionContext: () =>
        deps.mechanicFindingPropose.buildExecutionContext(),
      execute: (input) => deps.mechanicFindingPropose.buildPreview(input),
      buildResultSummary: (result) => ({
        workshop_task_id: (result as { workshop_task_id: string })
          .workshop_task_id,
        workshop_order_id: (result as { workshop_order_id: string })
          .workshop_order_id,
      }),
    }),
    'workshop.media_upload_slot': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      preview: (input) => previewWorkshopMediaUploadSlot(deps, input),
      execute: (input) => createWorkshopMediaUploadSlot(deps, input),
      buildResultSummary: (result) => ({
        media_id: (result as { media_id: string }).media_id,
        expires_at: (result as { expires_at: string }).expires_at,
      }),
      buildLogMetadata: (result) => ({
        entityType: 'WorkshopMedia',
        entityId: (result as { media_id: string }).media_id,
        reversible: true,
      }),
    }),
    'report.generate_weekly_pdf': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      preview: (input) => previewWeeklyReportPdf(deps, input),
      execute: (input) => generateWeeklyReportPdf(deps, input),
      executeOutsideTransaction: true,
      refreshReplayResult: (result) =>
        deps.weeklyReportMcp.refreshReplayResult(result),
      buildResultSummary: (result) => ({
        id: (result as { id: string }).id,
        expires_at: (result as { expires_at: string }).expires_at,
        page_count: (result as { page_count: number }).page_count,
        sha256: (result as { sha256: string }).sha256,
        period: (result as { period: unknown }).period,
        storage_bucket: (result as { storage_bucket: string }).storage_bucket,
        storage_key: (result as { storage_key: string }).storage_key,
        object_expires_at: (result as { object_expires_at: string })
          .object_expires_at,
      }),
    }),
    'workshop_order.add_line': (deps, actionType) => ({
      actionType,
      buildPolicyContext: (input) => {
        const record = asRecord(input);
        const quantity = Number(record.quantity ?? 1);
        const unitPrice = Number(
          record.unit_price ??
            record.unitPrice ??
            Number(record.unit_price_cents ?? 0) / 100,
        );
        return Promise.resolve({ amount_eur: quantity * unitPrice });
      },
      execute: (input) => addLineItem(lineItemDeps(deps), input),
      buildResultSummary: (result) => ({
        line_item_id: (result as { id: string }).id,
      }),
    }),
    'customer.update': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      execute: (input) => updateCustomer(deps, input),
      buildResultSummary: (result) => ({
        customer_id: (result as { id: string }).id,
      }),
      buildLogMetadata: (result) => ({
        entityType: 'Customer',
        entityId: (result as { id: string }).id,
        reversible: true,
      }),
    }),
    'decision.import_row_match': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      execute: (input) => executeImportRowMatchProposal(deps, input),
      buildResultSummary: (result) => ({
        import_job_id: (result as { id: string }).id,
      }),
      buildLogMetadata: (result) => ({
        entityType: 'ImportJob',
        entityId: (result as { id: string }).id,
        reversible: false,
      }),
    }),
    'decision.document_sort': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      execute: (input) => executeDocumentSortProposal(deps, input),
      buildResultSummary: (result) => ({
        document_brand_asset_id: (result as { id: string }).id,
      }),
      buildLogMetadata: (result) => ({
        entityType: 'DocumentBrandAsset',
        entityId: (result as { id: string }).id,
        reversible: false,
      }),
    }),
    'registration_intake.apply': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      buildExecutionContext: (input) =>
        registrationIntakeExecutionContext(deps, input),
      execute: (input) => applyRegistrationIntake(deps, input),
      buildResultSummary: (result) => ({
        intake_id: (result as { vehicleId: string }).vehicleId,
      }),
      buildLogMetadata: (result) => ({
        entityType: 'Vehicle',
        entityId: (result as { vehicleId: string }).vehicleId,
        reversible: true,
      }),
    }),
    'workshop.booking_package': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      buildExecutionContext: () =>
        deps.workshopBookingPackage.buildExecutionContext(),
      execute: (input, context) =>
        deps.workshopBookingPackage.applyPackage(input, context),
      buildResultSummary: (result) => ({
        workshop_order_id: (result as { workshop_order_id: string })
          .workshop_order_id,
        loaner_booking_id: (result as { loaner_booking_id?: string })
          .loaner_booking_id,
      }),
      buildLogMetadata: (result) => ({
        entityType: 'WorkshopOrder',
        entityId: (result as { workshop_order_id: string }).workshop_order_id,
        reversible: true,
      }),
    }),
    'purchase_order.propose_draft': (deps, actionType) => ({
      actionType,
      buildPolicyContext: (input) =>
        Promise.resolve(purchaseOrderProposePolicyContext(input)),
      buildExecutionContext: () =>
        deps.purchaseService.buildProposedPurchaseOrderExecutionContext(),
      execute: (input, context) =>
        deps.purchaseService.applyProposedPurchaseOrderDraft(input, context),
      buildResultSummary: (result) => ({
        purchase_order_id: (result as { purchase_order_id: string })
          .purchase_order_id,
        status: (result as { status: string }).status,
        totals: (result as { totals: { net: string } }).totals,
      }),
      buildLogMetadata: (result) => ({
        entityType: 'PurchaseOrder',
        entityId: (result as { purchase_order_id: string }).purchase_order_id,
        reversible: true,
      }),
    }),
    'workshop_order.complete': (deps, actionType) => ({
      actionType,
      buildPolicyContext: () => Promise.resolve({}),
      buildExecutionContext: () =>
        deps.workshopOrderCompletion.buildExecutionContext(),
      execute: (input, context) =>
        deps.workshopOrderCompletion.applyCompletion(input, context),
      buildResultSummary: (result) => ({
        workshop_order_id: (result as { workshop_order_id: string })
          .workshop_order_id,
        order_status: (result as { order_status: unknown }).order_status,
        ready_email: (result as { ready_email: unknown }).ready_email,
      }),
      buildLogMetadata: (result) => ({
        entityType: 'WorkshopOrder',
        entityId: (result as { workshop_order_id: string }).workshop_order_id,
        reversible: true,
      }),
    }),
    'invoice.create_draft_from_workshop_order': (deps, actionType) => ({
      actionType,
      buildPolicyContext: (input) =>
        deps.invoiceWorkshopDraftPropose.buildPolicyContext(input),
      buildExecutionContext: () =>
        deps.invoiceWorkshopDraftPropose.buildExecutionContext(),
      execute: (input, context) =>
        deps.invoiceWorkshopDraftPropose.applyDraft(input, context),
      buildResultSummary: (result) => ({
        invoice_id: (result as { invoice_id: string }).invoice_id,
        status: (result as { status: string }).status,
        totals: (result as { totals: { gross: string } }).totals,
        finalize_note: (result as { finalize_note: string }).finalize_note,
      }),
      buildLogMetadata: (result) => ({
        entityType: 'Invoice',
        entityId: (result as { invoice_id: string }).invoice_id,
        reversible: true,
      }),
    }),
    'workshop_estimate.send': estimateSendExecutor,
    'estimate.send_customer_message': estimateSendExecutor,
  };

function reservePartExecutor(
  deps: PendingActionRegistryDeps,
  actionType: PendingActionType,
): PendingActionExecutor {
  return {
    actionType,
    buildPolicyContext: (input) => reservePolicyContext(deps, input),
    execute: (input) => reservePart(deps, input),
    buildResultSummary: (result) => ({
      reservation_id: (result as { id: string }).id,
    }),
    buildLogMetadata: (result) => ({
      entityType: 'PartsReservation',
      entityId: (result as { id: string }).id,
      reversible: true,
    }),
  };
}

function releasePartExecutor(
  deps: PendingActionRegistryDeps,
  actionType: PendingActionType,
): PendingActionExecutor {
  return {
    actionType,
    buildPolicyContext: (input) => releasePolicyContext(deps, input),
    execute: (input) => releaseReservation(deps, input),
    buildResultSummary: (result) => ({
      reservation_id: (result as { id: string }).id,
    }),
    buildLogMetadata: (result) => ({
      entityType: 'PartsReservation',
      entityId: (result as { id: string }).id,
      reversible: true,
    }),
  };
}

function estimateSendExecutor(
  deps: PendingActionRegistryDeps,
  actionType: PendingActionType,
): PendingActionExecutor {
  return {
    actionType,
    buildPolicyContext: (input) =>
      deps.workshopEstimateSendPropose.buildPolicyContext(input),
    buildExecutionContext: () =>
      deps.workshopEstimateSendPropose.buildExecutionContext(),
    execute: (input, context) =>
      deps.workshopEstimateSendPropose.applySend(input, context),
    buildResultSummary: (result) => ({
      estimate_version_id: (result as { estimate_version_id: string })
        .estimate_version_id,
      estimate_number: (result as { estimate_number: string }).estimate_number,
      status: (result as { status: string }).status,
      totals: (result as { totals: { gross: string } }).totals,
    }),
    buildLogMetadata: (result) => ({
      entityType: 'WorkshopEstimateVersion',
      entityId: (result as { estimate_version_id: string }).estimate_version_id,
      reversible: false,
    }),
  };
}

@Injectable()
export class PendingActionExecutorService implements PendingActionRegistryDeps {
  readonly prisma: PrismaService;
  readonly tenantContext: TenantContextService;
  readonly siteContext: SiteContextService;
  readonly workshopIntake: WorkshopIntakeService;
  readonly partsRequisition: PartsRequisitionService;
  readonly registrationIntakeApply: RegistrationIntakeApplyService;
  readonly workshopBookingPackage: WorkshopBookingPackageService;
  readonly purchaseService: PurchaseService;
  readonly workshopOrderCompletion: WorkshopOrderCompletionService;
  readonly invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService;
  readonly workshopEstimateSendPropose: WorkshopEstimateSendProposeService;
  readonly workshopMediaUploadMcp: WorkshopMediaUploadMcpService;
  readonly mechanicFindingPropose: MechanicFindingProposeService;
  readonly weeklyReportMcp: WeeklyReportMcpService;

  constructor(
    prisma: PrismaService,
    tenantContext: TenantContextService,
    siteContext: SiteContextService,
    workshopIntake: WorkshopIntakeService,
    partsRequisition: PartsRequisitionService,
    registrationIntakeApply: RegistrationIntakeApplyService,
    workshopBookingPackage: WorkshopBookingPackageService,
    purchaseService: PurchaseService,
    workshopOrderCompletion: WorkshopOrderCompletionService,
    invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService,
    workshopEstimateSendPropose: WorkshopEstimateSendProposeService,
    workshopMediaUploadMcp: WorkshopMediaUploadMcpService,
    mechanicFindingPropose: MechanicFindingProposeService,
    weeklyReportMcp: WeeklyReportMcpService,
  ) {
    this.prisma = prisma;
    this.tenantContext = tenantContext;
    this.siteContext = siteContext;
    this.workshopIntake = workshopIntake;
    this.partsRequisition = partsRequisition;
    this.registrationIntakeApply = registrationIntakeApply;
    this.workshopBookingPackage = workshopBookingPackage;
    this.purchaseService = purchaseService;
    this.workshopOrderCompletion = workshopOrderCompletion;
    this.invoiceWorkshopDraftPropose = invoiceWorkshopDraftPropose;
    this.workshopEstimateSendPropose = workshopEstimateSendPropose;
    this.workshopMediaUploadMcp = workshopMediaUploadMcp;
    this.mechanicFindingPropose = mechanicFindingPropose;
    this.weeklyReportMcp = weeklyReportMcp;
  }

  resolve(actionType: string): PendingActionExecutor {
    return resolvePendingActionExecutor(this, actionType);
  }
}
