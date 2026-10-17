import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ImportJobStatus, Prisma, WorkshopLineItemType } from '@prisma/client';
import { confirmationAfterEmailWrite } from '../customer/customer-contact-email.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { syncWorkshopEstimateOverrunAfterWrite } from '../workshop/workshop-estimate-overrun-sync.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import { incrementTaskLineItemsVersion } from '../workshop/workshop-task-line-items.helpers.js';
import {
  partExecutionStatusForNewLine,
  resolveWorkshopLineItemType,
} from '../workshop/workshop-line-item-type.helpers.js';
import { assertOrderEditable } from '../workshop/workshop-order.helpers.js';
import { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import {
  draftWorkshopOrderInputSchema,
  proposeLineItemInputSchema,
  releaseReservationInputSchema,
  reservePartInputSchema,
} from '../mcp/mcp-tool-schemas.js';
import {
  applyDocumentSortType,
  applyImportRowMatchChanges,
  refreshImportJobTotals,
} from '../decision/decision-live-apply.util.js';
import { DOCUMENT_SORT_TYPES } from '../decision/decision.constants.js';
import { RegistrationIntakeApplyService } from '../registration-intake/registration-intake-apply.service.js';
import { proposeRegistrationIntakeInputSchema } from '../mcp/mcp-tool-schemas.js';
import { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import { PurchaseService } from '../purchase/purchase.service.js';
import { proposePurchaseOrderInputSchema } from '../purchase/purchase-propose-draft.schema.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import { WorkshopMediaUploadMcpService } from '../mechanic/workshop-media-upload-mcp.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import { requestWorkshopMediaUploadInputSchema } from '../mechanic/mechanic-finding-propose.schema.js';
import { WeeklyReportMcpService } from '../reports/weekly-report/weekly-report-mcp.service.js';
import { generateWeeklyReportPdfInputSchema } from '../reports/weekly-report/weekly-report-mcp.schema.js';
import type { McpWriteToolResult } from '../mcp/mcp-write-pipeline.service.js';

export type PendingActionType =
  | 'workshop_order.create'
  | 'workshop.booking_package'
  | 'purchase_order.propose_draft'
  | 'workshop_task.reserve_part'
  | 'inventory.part_reserve'
  | 'workshop_task.release_reservation'
  | 'inventory.part_release'
  | 'workshop_order.propose_line'
  | 'workshop_order.add_line'
  | 'customer.update'
  | 'decision.import_row_match'
  | 'decision.document_sort'
  | 'registration_intake.apply'
  | 'workshop_order.mechanic_finding'
  | 'workshop_order.propose_mechanic_finding'
  | 'workshop.media_upload_slot'
  | 'workshop_order.complete'
  | 'invoice.create_draft_from_workshop_order'
  | 'report.generate_weekly_pdf';

export type PendingActionExecutor = {
  actionType: PendingActionType;
  buildPolicyContext(input: unknown): Promise<AgentPolicyEvaluateContext>;
  buildExecutionContext?(input: unknown): Promise<Record<string, unknown>>;
  execute(
    input: unknown,
    executionContext?: Record<string, unknown>,
  ): Promise<unknown>;
  buildResultSummary(result: unknown): unknown;
  buildLogMetadata?(result: unknown): {
    entityType: string;
    entityId: string;
    reversible: boolean;
  };
  /** Side-effect-free MCP dry-run preview (skips rollback transaction execute). */
  preview?(
    input: unknown,
    executionContext?: Record<string, unknown>,
  ): Promise<unknown>;
  /** When true, real execute runs before the agent-action log transaction. */
  executeOutsideTransaction?: boolean;
  refreshReplayResult?(result: McpWriteToolResult): Promise<McpWriteToolResult>;
};

@Injectable()
export class PendingActionExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly workshopIntake: WorkshopIntakeService,
    private readonly partsRequisition: PartsRequisitionService,
    private readonly registrationIntakeApply: RegistrationIntakeApplyService,
    private readonly workshopBookingPackage: WorkshopBookingPackageService,
    private readonly purchaseService: PurchaseService,
    private readonly workshopOrderCompletion: WorkshopOrderCompletionService,
    private readonly invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService,
    private readonly workshopMediaUploadMcp: WorkshopMediaUploadMcpService,
    private readonly mechanicFindingPropose: MechanicFindingProposeService,
    private readonly weeklyReportMcp: WeeklyReportMcpService,
  ) {}

  resolve(actionType: string): PendingActionExecutor {
    switch (actionType) {
      case 'workshop_order.create':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          buildExecutionContext: async () => ({
            site_id: await this.siteContext.getSiteId(),
          }),
          execute: (input, context) => this.createWorkshopOrder(input, context),
          buildResultSummary: (result) => ({
            workshop_order_id: (result as { id: string }).id,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'WorkshopOrder',
            entityId: (result as { id: string }).id,
            reversible: true,
          }),
        };
      case 'workshop_task.reserve_part':
      case 'inventory.part_reserve':
        return {
          actionType,
          buildPolicyContext: (input) => this.reservePolicyContext(input),
          execute: (input) => this.reservePart(input),
          buildResultSummary: (result) => ({
            reservation_id: (result as { id: string }).id,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'PartsReservation',
            entityId: (result as { id: string }).id,
            reversible: true,
          }),
        };
      case 'workshop_task.release_reservation':
      case 'inventory.part_release':
        return {
          actionType,
          buildPolicyContext: (input) => this.releasePolicyContext(input),
          execute: (input) => this.releaseReservation(input),
          buildResultSummary: (result) => ({
            reservation_id: (result as { id: string }).id,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'PartsReservation',
            entityId: (result as { id: string }).id,
            reversible: true,
          }),
        };
      case 'workshop_order.propose_line':
        return {
          actionType,
          buildPolicyContext: (input) =>
            Promise.resolve(this.proposeLinePolicyContext(input)),
          execute: (input) => this.addProposedLineItem(input),
          buildResultSummary: (result) => ({
            line_item_id: (result as { id: string }).id,
          }),
        };
      case 'workshop_order.mechanic_finding':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          buildExecutionContext: async (input) => {
            const record = this.asRecord(input);
            const siteId =
              typeof record.site_id === 'string'
                ? record.site_id
                : await this.siteContext.getSiteId();
            return { site_id: siteId };
          },
          execute: (input, executionContext) =>
            this.mechanicFindingPropose.applyAcknowledgment(
              input,
              executionContext,
            ),
          buildResultSummary: (result) => ({
            workshop_task_id: (result as { workshop_task_id: string })
              .workshop_task_id,
            workshop_order_id: (result as { workshop_order_id: string })
              .workshop_order_id,
          }),
        };
      case 'workshop_order.propose_mechanic_finding':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          buildExecutionContext: () =>
            this.mechanicFindingPropose.buildExecutionContext(),
          execute: (input) => this.mechanicFindingPropose.buildPreview(input),
          buildResultSummary: (result) => ({
            workshop_task_id: (result as { workshop_task_id: string })
              .workshop_task_id,
            workshop_order_id: (result as { workshop_order_id: string })
              .workshop_order_id,
          }),
        };
      case 'workshop.media_upload_slot':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          execute: (input) => this.createWorkshopMediaUploadSlot(input),
          buildResultSummary: (result) => ({
            media_id: (result as { media_id: string }).media_id,
            expires_at: (result as { expires_at: string }).expires_at,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'WorkshopMedia',
            entityId: (result as { media_id: string }).media_id,
            reversible: true,
          }),
        };
      case 'report.generate_weekly_pdf':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          preview: (input) => this.previewWeeklyReportPdf(input),
          execute: (input) => this.generateWeeklyReportPdf(input),
          executeOutsideTransaction: true,
          refreshReplayResult: (result) =>
            this.weeklyReportMcp.refreshReplayResult(result),
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
        };
      case 'workshop_order.add_line':
        return {
          actionType,
          buildPolicyContext: (input) => {
            const record = this.asRecord(input);
            const quantity = Number(record.quantity ?? 1);
            const unitPrice = Number(
              record.unit_price ??
                record.unitPrice ??
                Number(record.unit_price_cents ?? 0) / 100,
            );
            return Promise.resolve({ amount_eur: quantity * unitPrice });
          },
          execute: (input) => this.addLineItem(input),
          buildResultSummary: (result) => ({
            line_item_id: (result as { id: string }).id,
          }),
        };
      case 'customer.update':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          execute: (input) => this.updateCustomer(input),
          buildResultSummary: (result) => ({
            customer_id: (result as { id: string }).id,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'Customer',
            entityId: (result as { id: string }).id,
            reversible: true,
          }),
        };
      case 'decision.import_row_match':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          execute: (input) => this.executeImportRowMatchProposal(input),
          buildResultSummary: (result) => ({
            import_job_id: (result as { id: string }).id,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'ImportJob',
            entityId: (result as { id: string }).id,
            reversible: false,
          }),
        };
      case 'decision.document_sort':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          execute: (input) => this.executeDocumentSortProposal(input),
          buildResultSummary: (result) => ({
            document_brand_asset_id: (result as { id: string }).id,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'DocumentBrandAsset',
            entityId: (result as { id: string }).id,
            reversible: false,
          }),
        };
      case 'registration_intake.apply':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          buildExecutionContext: (input) =>
            this.registrationIntakeExecutionContext(input),
          execute: (input) => this.applyRegistrationIntake(input),
          buildResultSummary: (result) => ({
            intake_id: (result as { vehicleId: string }).vehicleId,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'Vehicle',
            entityId: (result as { vehicleId: string }).vehicleId,
            reversible: true,
          }),
        };
      case 'workshop.booking_package':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          buildExecutionContext: () =>
            this.workshopBookingPackage.buildExecutionContext(),
          execute: (input, context) =>
            this.workshopBookingPackage.applyPackage(input, context),
          buildResultSummary: (result) => ({
            workshop_order_id: (result as { workshop_order_id: string })
              .workshop_order_id,
            loaner_booking_id: (result as { loaner_booking_id?: string })
              .loaner_booking_id,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'WorkshopOrder',
            entityId: (result as { workshop_order_id: string })
              .workshop_order_id,
            reversible: true,
          }),
        };
      case 'purchase_order.propose_draft':
        return {
          actionType,
          buildPolicyContext: (input) =>
            Promise.resolve(this.purchaseOrderProposePolicyContext(input)),
          buildExecutionContext: () =>
            this.purchaseService.buildProposedPurchaseOrderExecutionContext(),
          execute: (input, context) =>
            this.purchaseService.applyProposedPurchaseOrderDraft(
              input,
              context,
            ),
          buildResultSummary: (result) => ({
            purchase_order_id: (result as { purchase_order_id: string })
              .purchase_order_id,
            status: (result as { status: string }).status,
            totals: (result as { totals: { net: string } }).totals,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'PurchaseOrder',
            entityId: (result as { purchase_order_id: string })
              .purchase_order_id,
            reversible: true,
          }),
        };
      case 'workshop_order.complete':
        return {
          actionType,
          buildPolicyContext: () => Promise.resolve({}),
          buildExecutionContext: () =>
            this.workshopOrderCompletion.buildExecutionContext(),
          execute: (input, context) =>
            this.workshopOrderCompletion.applyCompletion(input, context),
          buildResultSummary: (result) => ({
            workshop_order_id: (result as { workshop_order_id: string })
              .workshop_order_id,
            order_status: (result as { order_status: unknown }).order_status,
            ready_email: (result as { ready_email: unknown }).ready_email,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'WorkshopOrder',
            entityId: (result as { workshop_order_id: string })
              .workshop_order_id,
            reversible: true,
          }),
        };
      case 'invoice.create_draft_from_workshop_order':
        return {
          actionType,
          buildPolicyContext: (input) =>
            this.invoiceWorkshopDraftPropose.buildPolicyContext(input),
          buildExecutionContext: () =>
            this.invoiceWorkshopDraftPropose.buildExecutionContext(),
          execute: (input, context) =>
            this.invoiceWorkshopDraftPropose.applyDraft(input, context),
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
        };
      default:
        throw new BadRequestException(
          `Unsupported action type for automatic execution: ${actionType}`,
        );
    }
  }

  private async createWorkshopOrder(
    input: unknown,
    context?: Record<string, unknown>,
  ): Promise<unknown> {
    const record = draftWorkshopOrderInputSchema.parse(input);
    const dto = {
      customerId: record.customer_id,
      vehicleId: record.vehicle_id,
      purpose: record.purpose,
      status: record.status,
      bayId: record.bay_id,
      mechanicId: record.mechanic_id,
      scheduledStartAt: record.scheduled_start_at,
      scheduledEndAt: record.scheduled_end_at,
      odometer: record.odometer,
      fuelLevel: record.fuel_level,
      reportedIssue: record.reported_issue,
      notes: record.notes,
    };
    const siteId = context?.site_id;
    return typeof siteId === 'string'
      ? this.workshopIntake.createAtSite(dto, siteId)
      : this.workshopIntake.create(dto);
  }

  private async reservePolicyContext(
    input: unknown,
  ): Promise<AgentPolicyEvaluateContext> {
    const record = this.asRecord(input);
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const line = await this.prisma.workshopTaskLineItem.findFirst({
      where: {
        id: record.workshop_task_line_item_id as string,
        tenant_id: tenantId,
        workshop_task: { workshop_order: { site_id: siteId } },
      },
      select: { unit_price: true },
    });
    if (!line) return {};
    const amountCents = new Prisma.Decimal(record.quantity as number)
      .mul(line.unit_price)
      .mul(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();
    return { amount_eur: amountCents / 100 };
  }

  private async releasePolicyContext(
    input: unknown,
  ): Promise<AgentPolicyEvaluateContext> {
    const record = this.asRecord(input);
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const reservation = await this.prisma.partsReservation.findFirst({
      where: {
        id: record.reservation_id as string,
        tenant_id: tenantId,
        workshop_task_line_item: {
          workshop_task: { workshop_order: { site_id: siteId } },
        },
      },
      select: {
        quantity: true,
        quantity_consumed: true,
        quantity_returned: true,
        workshop_task_line_item: { select: { unit_price: true } },
      },
    });
    if (!reservation) return {};
    const quantity = new Prisma.Decimal(reservation.quantity)
      .sub(reservation.quantity_consumed)
      .sub(reservation.quantity_returned);
    const amountCents = quantity.gt(0)
      ? quantity
          .mul(reservation.workshop_task_line_item.unit_price)
          .mul(100)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber()
      : 0;
    return { amount_eur: amountCents / 100 };
  }

  private async reservePart(input: unknown): Promise<unknown> {
    const record = reservePartInputSchema.parse(input);
    return this.partsRequisition.createOnHandReservation({
      workshopTaskLineItemId: record.workshop_task_line_item_id,
      quantity: record.quantity,
      locationId: record.location_id,
    });
  }

  private async releaseReservation(input: unknown): Promise<unknown> {
    const record = releaseReservationInputSchema.parse(input);
    return this.partsRequisition.releaseReservation(
      record.reservation_id,
      record.return_location_id !== undefined
        ? { returnLocationId: record.return_location_id }
        : {},
    );
  }

  private async updateCustomer(input: unknown): Promise<unknown> {
    const record = this.asRecord(input);
    const customerId =
      typeof record.customer_id === 'string'
        ? record.customer_id
        : typeof record.customerId === 'string'
          ? record.customerId
          : '';
    if (!customerId) {
      throw new BadRequestException(
        'customer.update payload requires customer_id',
      );
    }
    const tenantId = await this.tenantContext.getTenantId();
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
      select: { id: true, email: true },
    });
    if (!customer)
      throw new NotFoundException(`Customer ${customerId} not found`);
    const data: Prisma.CustomerUpdateManyMutationInput = {};
    if (typeof record.first_name === 'string')
      data.first_name = record.first_name;
    if (typeof record.last_name === 'string') data.last_name = record.last_name;
    if (typeof record.email === 'string') data.email = record.email;
    // A changed address withdraws the advisor's confirmation for order communication (ADR-0025 §8).
    if (confirmationAfterEmailWrite(customer.email, data) === false) {
      data.contact_email_ok = false;
    }
    if (typeof record.phone === 'string') data.phone = record.phone;
    await this.prisma.customer.updateMany({
      where: { id: customer.id, tenant_id: tenantId },
      data,
    });
    return { id: customer.id, entityId: customer.id };
  }

  private proposeLinePolicyContext(input: unknown): AgentPolicyEvaluateContext {
    const parsed = proposeLineItemInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException('Invalid proposed line item payload');
    }
    return {
      amount_eur:
        (parsed.data.line_item.quantity *
          parsed.data.line_item.unit_price_cents) /
        100,
    };
  }

  private purchaseOrderProposePolicyContext(
    input: unknown,
  ): AgentPolicyEvaluateContext {
    const parsed = proposePurchaseOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException('Invalid purchase order proposal payload');
    }
    const amountEur = parsed.data.lines.reduce((sum, line) => {
      const unitCost = Number(line.cost_basis.unit_cost_net);
      return sum + unitCost;
    }, 0);
    return { amount_eur: amountEur };
  }

  private addProposedLineItem(input: unknown): Promise<unknown> {
    const parsed = proposeLineItemInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException('Invalid proposed line item payload');
    }
    return this.addLineItem(input, parsed.data.line_item);
  }

  /** A proposed line changes the estimate lines, so an overrun is recorded once it is written (AUT-355). */
  private async addLineItem(
    input: unknown,
    validatedLine?: Record<string, unknown>,
  ): Promise<unknown> {
    const result = await this.addLineItemWithoutSync(input, validatedLine);
    const record = this.asRecord(input);
    const orderId =
      typeof record.workshop_order_id === 'string'
        ? record.workshop_order_id
        : typeof record.order_id === 'string'
          ? record.order_id
          : null;
    if (orderId) {
      await syncWorkshopEstimateOverrunAfterWrite(
        this.prisma,
        this.siteContext,
        await this.tenantContext.getTenantId(),
        orderId,
      );
    }
    return result;
  }

  private async addLineItemWithoutSync(
    input: unknown,
    validatedLine?: Record<string, unknown>,
  ): Promise<unknown> {
    const record = this.asRecord(input);
    const parsed = proposeLineItemInputSchema.safeParse(input);
    const line: Record<string, unknown> =
      validatedLine ??
      (parsed.success
        ? parsed.data.line_item
        : this.asRecord(record.line_item ?? record));
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const orderId =
      typeof record.workshop_order_id === 'string'
        ? record.workshop_order_id
        : typeof record.order_id === 'string'
          ? record.order_id
          : '';
    const payloadSiteId = record.site_id ?? record.siteId;
    if (
      payloadSiteId !== undefined &&
      payloadSiteId !== null &&
      typeof payloadSiteId !== 'string'
    ) {
      throw new BadRequestException('Action payload site must be a string');
    }
    if (payloadSiteId && payloadSiteId !== siteId) {
      throw new BadRequestException(
        `Action payload site (${payloadSiteId}) does not match caller authorized site (${siteId})`,
      );
    }
    const callerSite = await this.prisma.site.updateMany({
      where: { id: siteId, tenant_id: tenantId, is_active: true },
      data: { is_active: true },
    });
    if (callerSite.count !== 1) {
      throw new UnprocessableEntityException(
        'The active site is no longer available',
      );
    }
    const order = await this.prisma.workshopOrder.findFirst({
      where: {
        id: orderId,
        tenant_id: tenantId,
        site_id: siteId,
      },
      include: {
        tasks: {
          where: {
            tenant_id: tenantId,
            workshop_order: { tenant_id: tenantId, site_id: siteId },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order)
      throw new NotFoundException(`Workshop order ${orderId} not found`);
    assertOrderEditable(order);

    const taskId = (record.workshop_task_id ?? record.task_id) as
      string | undefined;
    let task = taskId
      ? order.tasks.find((candidate) => candidate.id === taskId)
      : order.tasks[0];
    if (!task && taskId) {
      throw new NotFoundException(
        `Workshop task ${taskId} not found on order ${orderId}`,
      );
    }
    if (!task) {
      task = await this.prisma.workshopTask.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: order.id,
          title: 'General Service',
        },
      });
    }
    const expectedVersion = Number(
      record.expected_line_items_version ?? task.line_items_version,
    );
    await incrementTaskLineItemsVersion({
      tx: this.prisma,
      tenantId,
      siteId,
      taskId: task.id,
      expectedLineItemsVersion: expectedVersion,
    });
    const unitPrice =
      line.unit_price_cents !== undefined
        ? Number(line.unit_price_cents) / 100
        : Number(line.unit_price ?? line.unitPrice ?? 0);
    const lineType = resolveWorkshopLineItemType(String(line.type));
    const isLabor = lineType === WorkshopLineItemType.LABOR;
    const created = await this.prisma.workshopTaskLineItem.create({
      data: {
        tenant_id: tenantId,
        workshop_task_id: task.id,
        type: lineType,
        part_execution_status: partExecutionStatusForNewLine(lineType),
        item_no: typeof line.item_no === 'string' ? line.item_no : 'MISC',
        description:
          typeof line.description === 'string'
            ? line.description
            : 'Proposed line item',
        quantity: new Prisma.Decimal(Number(line.quantity ?? 1)),
        unit_price: new Prisma.Decimal(unitPrice),
        labor_operation_id: isLabor
          ? ((line.labor_operation_id as string | undefined) ?? null)
          : null,
      },
      select: { id: true },
    });
    return { id: created.id, entityId: created.id };
  }

  private async createWorkshopMediaUploadSlot(
    input: unknown,
  ): Promise<unknown> {
    const parsed = requestWorkshopMediaUploadInputSchema.parse(input);
    return this.workshopMediaUploadMcp.createUploadSlot(parsed);
  }

  private async previewWeeklyReportPdf(input: unknown): Promise<unknown> {
    const parsed = generateWeeklyReportPdfInputSchema.parse(input);
    return this.weeklyReportMcp.preview(parsed);
  }

  private async generateWeeklyReportPdf(input: unknown): Promise<unknown> {
    const parsed = generateWeeklyReportPdfInputSchema.parse(input);
    return this.weeklyReportMcp.execute(parsed);
  }

  /**
   * AUT-413 approval of a PROPOSE import match. Same write as live AUTO, scoped
   * to the approver's tenant. Only a dry-run job still awaiting confirmation can
   * change, and only a row that is still CREATE.
   */
  private async executeImportRowMatchProposal(
    input: unknown,
  ): Promise<unknown> {
    const record = this.asRecord(input);
    const jobId =
      typeof record.import_job_id === 'string' ? record.import_job_id : '';
    const rowNo = record.row_no;
    const customerId =
      typeof record.customer_id === 'string' ? record.customer_id : '';
    if (
      !jobId ||
      typeof rowNo !== 'number' ||
      !Number.isInteger(rowNo) ||
      !customerId
    ) {
      throw new BadRequestException(
        'decision.import_row_match payload requires import_job_id, row_no and customer_id',
      );
    }
    const tenantId = await this.tenantContext.getTenantId();
    const job = await this.prisma.importJob.findFirst({
      where: {
        id: jobId,
        tenant_id: tenantId,
        status: ImportJobStatus.DRY_RUN_DONE,
      },
      select: { id: true },
    });
    if (!job) {
      throw new UnprocessableEntityException(
        'Import job is no longer awaiting confirmation',
      );
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    const appliedRowNos = await applyImportRowMatchChanges(this.prisma, {
      tenantId,
      jobId,
      changes: [{ row_no: rowNo, customer_id: customer.id }],
    });
    if (appliedRowNos.length !== 1) {
      throw new ConflictException(
        'Import row changed since the suggestion was made',
      );
    }
    // Recount from the rows under the job lock. A stored total is never adjusted.
    const totals = await refreshImportJobTotals(this.prisma, {
      tenantId,
      jobId,
    });
    if (!totals) {
      throw new ConflictException(
        'Import job is no longer awaiting confirmation',
      );
    }
    return { id: jobId, entityId: jobId };
  }

  /** AUT-413 approval of a PROPOSE document type. Sets it only while it is still unset. */
  private async executeDocumentSortProposal(input: unknown): Promise<unknown> {
    const record = this.asRecord(input);
    const assetId =
      typeof record.document_brand_asset_id === 'string'
        ? record.document_brand_asset_id
        : '';
    const sortType = DOCUMENT_SORT_TYPES.find(
      (candidate) => candidate === record.document_sort_type,
    );
    if (!assetId || !sortType) {
      throw new BadRequestException(
        'decision.document_sort payload requires document_brand_asset_id and a valid document_sort_type',
      );
    }
    const tenantId = await this.tenantContext.getTenantId();
    const applied = await applyDocumentSortType(this.prisma, {
      tenantId,
      assetId,
      sortType,
    });
    if (!applied) {
      throw new ConflictException(
        'Document type is already set or the asset is not ready',
      );
    }
    return { id: assetId, entityId: assetId };
  }

  private async registrationIntakeExecutionContext(
    input: unknown,
  ): Promise<Record<string, unknown>> {
    const record = proposeRegistrationIntakeInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    const intake = await this.prisma.registrationDocumentIntake.findFirst({
      where: {
        id: record.intake_id,
        tenant_id: tenantId,
      },
      select: { site_id: true },
    });
    if (!intake) {
      throw new NotFoundException(
        `Registration intake ${record.intake_id} not found`,
      );
    }
    const siteId = await this.siteContext.getSiteId();
    if (intake.site_id !== siteId) {
      throw new NotFoundException(
        `Registration intake ${record.intake_id} not found`,
      );
    }
    return { site_id: intake.site_id };
  }

  private async applyRegistrationIntake(input: unknown): Promise<unknown> {
    const record = proposeRegistrationIntakeInputSchema.parse(input);
    return this.registrationIntakeApply.apply(record.intake_id, {
      vin: record.vin,
      plate: record.plate,
      holder: {
        firstName: record.holder.first_name,
        lastName: record.holder.last_name,
      },
      nationalcode: record.nationalcode,
      firstRegistration: record.first_registration,
      co2: record.co2 ?? null,
      make: record.make,
      model: record.model,
      year: record.year,
      customerId: record.customer_id,
      vehicleId: record.vehicle_id,
      ownershipCorrection: record.ownership_correction
        ? {
            expectedCustomerId:
              record.ownership_correction.expected_customer_id,
            nextCustomerId: record.ownership_correction.next_customer_id,
          }
        : undefined,
    });
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
