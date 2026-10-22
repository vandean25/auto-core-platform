import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ImportJobStatus, Prisma } from '@prisma/client';
import { confirmationAfterEmailWrite } from '../customer/customer-contact-email.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import type { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import type { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import type { RegistrationIntakeApplyService } from '../registration-intake/registration-intake-apply.service.js';
import type { WorkshopMediaUploadMcpService } from '../mechanic/workshop-media-upload-mcp.service.js';
import type { WeeklyReportMcpService } from '../reports/weekly-report/weekly-report-mcp.service.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import {
  draftWorkshopOrderInputSchema,
  proposeRegistrationIntakeInputSchema,
  releaseReservationInputSchema,
  reservePartInputSchema,
} from '../mcp/mcp-tool-schemas.js';
import {
  applyDocumentSortType,
  applyImportRowMatchChanges,
  refreshImportJobTotals,
} from '../decision/decision-live-apply.util.js';
import { DOCUMENT_SORT_TYPES } from '../decision/decision.constants.js';
import { proposePurchaseOrderInputSchema } from '../purchase/purchase-propose-draft.schema.js';
import { requestWorkshopMediaUploadInputSchema } from '../mechanic/mechanic-finding-propose.schema.js';
import { generateWeeklyReportPdfInputSchema } from '../reports/weekly-report/weekly-report-mcp.schema.js';
import { asRecord } from './pending-action-executor.util.js';
import type { CustomerExecutorDeps } from './pending-action-executor.customer.js';

export type PendingActionHandlerDeps = {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  siteContext: SiteContextService;
  workshopIntake: WorkshopIntakeService;
  partsRequisition: PartsRequisitionService;
  registrationIntakeApply: RegistrationIntakeApplyService;
  workshopMediaUploadMcp: WorkshopMediaUploadMcpService;
  weeklyReportMcp: WeeklyReportMcpService;
};

export async function createWorkshopOrder(
  deps: PendingActionHandlerDeps,
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
    ? deps.workshopIntake.createAtSite(dto, siteId)
    : deps.workshopIntake.create(dto);
}

export async function reservePolicyContext(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<AgentPolicyEvaluateContext> {
  const record = asRecord(input);
  const [tenantId, siteId] = await Promise.all([
    deps.tenantContext.getTenantId(),
    deps.siteContext.getSiteId(),
  ]);
  const line = await deps.prisma.workshopTaskLineItem.findFirst({
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

export async function releasePolicyContext(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<AgentPolicyEvaluateContext> {
  const record = asRecord(input);
  const [tenantId, siteId] = await Promise.all([
    deps.tenantContext.getTenantId(),
    deps.siteContext.getSiteId(),
  ]);
  const reservation = await deps.prisma.partsReservation.findFirst({
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

export async function reservePart(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<unknown> {
  const record = reservePartInputSchema.parse(input);
  return deps.partsRequisition.createOnHandReservation({
    workshopTaskLineItemId: record.workshop_task_line_item_id,
    quantity: record.quantity,
    locationId: record.location_id,
  });
}

export async function releaseReservation(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<unknown> {
  const record = releaseReservationInputSchema.parse(input);
  return deps.partsRequisition.releaseReservation(
    record.reservation_id,
    record.return_location_id !== undefined
      ? { returnLocationId: record.return_location_id }
      : {},
  );
}

export async function updateCustomer(
  deps: CustomerExecutorDeps,
  input: unknown,
): Promise<unknown> {
  const record = asRecord(input);
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
  const tenantId = await deps.tenantContext.getTenantId();
  const customer = await deps.prisma.customer.findFirst({
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
  if (confirmationAfterEmailWrite(customer.email, data) === false) {
    data.contact_email_ok = false;
  }
  if (typeof record.phone === 'string') data.phone = record.phone;
  await deps.prisma.customer.updateMany({
    where: { id: customer.id, tenant_id: tenantId },
    data,
  });
  return { id: customer.id, entityId: customer.id };
}

export function purchaseOrderProposePolicyContext(
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

export async function executeImportRowMatchProposal(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<unknown> {
  const record = asRecord(input);
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
  const tenantId = await deps.tenantContext.getTenantId();
  const job = await deps.prisma.importJob.findFirst({
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
  const customer = await deps.prisma.customer.findFirst({
    where: { id: customerId, tenant_id: tenantId },
    select: { id: true },
  });
  if (!customer) {
    throw new NotFoundException(`Customer ${customerId} not found`);
  }
  const appliedRowNos = await applyImportRowMatchChanges(deps.prisma, {
    tenantId,
    jobId,
    changes: [{ row_no: rowNo, customer_id: customer.id }],
  });
  if (appliedRowNos.length !== 1) {
    throw new ConflictException(
      'Import row changed since the suggestion was made',
    );
  }
  const totals = await refreshImportJobTotals(deps.prisma, {
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

export async function executeDocumentSortProposal(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<unknown> {
  const record = asRecord(input);
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
  const tenantId = await deps.tenantContext.getTenantId();
  const applied = await applyDocumentSortType(deps.prisma, {
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

export async function registrationIntakeExecutionContext(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<Record<string, unknown>> {
  const record = proposeRegistrationIntakeInputSchema.parse(input);
  const tenantId = await deps.tenantContext.getTenantId();
  const intake = await deps.prisma.registrationDocumentIntake.findFirst({
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
  const siteId = await deps.siteContext.getSiteId();
  if (intake.site_id !== siteId) {
    throw new NotFoundException(
      `Registration intake ${record.intake_id} not found`,
    );
  }
  return { site_id: intake.site_id };
}

export async function applyRegistrationIntake(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<unknown> {
  const record = proposeRegistrationIntakeInputSchema.parse(input);
  return deps.registrationIntakeApply.apply(record.intake_id, {
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
          expectedCustomerId: record.ownership_correction.expected_customer_id,
          nextCustomerId: record.ownership_correction.next_customer_id,
        }
      : undefined,
  });
}

export async function createWorkshopMediaUploadSlot(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<unknown> {
  const parsed = requestWorkshopMediaUploadInputSchema.parse(input);
  return deps.workshopMediaUploadMcp.createUploadSlot(parsed);
}

export async function previewWeeklyReportPdf(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<unknown> {
  const parsed = generateWeeklyReportPdfInputSchema.parse(input);
  return deps.weeklyReportMcp.preview(parsed);
}

export async function generateWeeklyReportPdf(
  deps: PendingActionHandlerDeps,
  input: unknown,
): Promise<unknown> {
  const parsed = generateWeeklyReportPdfInputSchema.parse(input);
  return deps.weeklyReportMcp.execute(parsed);
}
