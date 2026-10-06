import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WorkshopLineItemType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import { incrementTaskLineItemsVersion } from '../workshop/workshop-task-line-items.helpers.js';
import { assertOrderEditable } from '../workshop/workshop-order.helpers.js';
import { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import {
  draftWorkshopOrderInputSchema,
  proposeLineItemInputSchema,
  releaseReservationInputSchema,
  reservePartInputSchema,
} from '../mcp/mcp-tool-schemas.js';

export type PendingActionType =
  | 'workshop_order.create'
  | 'workshop_task.reserve_part'
  | 'inventory.part_reserve'
  | 'workshop_task.release_reservation'
  | 'inventory.part_release'
  | 'workshop_order.propose_line'
  | 'workshop_order.add_line'
  | 'customer.update';

export type PendingActionExecutor = {
  actionType: PendingActionType;
  buildPolicyContext(input: unknown): Promise<AgentPolicyEvaluateContext>;
  buildExecutionContext?(): Promise<Record<string, unknown>>;
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
};

@Injectable()
export class PendingActionExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly workshopIntake: WorkshopIntakeService,
    private readonly partsRequisition: PartsRequisitionService,
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
      select: { id: true },
    });
    if (!customer)
      throw new NotFoundException(`Customer ${customerId} not found`);
    const data: Prisma.CustomerUpdateManyMutationInput = {};
    if (typeof record.first_name === 'string')
      data.first_name = record.first_name;
    if (typeof record.last_name === 'string') data.last_name = record.last_name;
    if (typeof record.email === 'string') data.email = record.email;
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

  private addProposedLineItem(input: unknown): Promise<unknown> {
    const parsed = proposeLineItemInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException('Invalid proposed line item payload');
    }
    return this.addLineItem(input, parsed.data.line_item);
  }

  private async addLineItem(
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
    const created = await this.prisma.workshopTaskLineItem.create({
      data: {
        tenant_id: tenantId,
        workshop_task_id: task.id,
        type:
          line.type === 'LABOR'
            ? WorkshopLineItemType.LABOR
            : WorkshopLineItemType.PART,
        part_execution_status: line.type === 'PART' ? 'PENDING_PICK' : null,
        item_no: typeof line.item_no === 'string' ? line.item_no : 'MISC',
        description:
          typeof line.description === 'string'
            ? line.description
            : 'Proposed line item',
        quantity: new Prisma.Decimal(Number(line.quantity ?? 1)),
        unit_price: new Prisma.Decimal(unitPrice),
        labor_operation_id:
          (line.labor_operation_id as string | undefined) ?? null,
      },
      select: { id: true },
    });
    return { id: created.id, entityId: created.id };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
