import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PLAN_STALE } from './workshop-position-plan.types.js';
import { WorkshopOrderPurpose, WorkshopOrderStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { LoanerVehiclesAuthorization } from '../loaner-vehicles/loaner-vehicles.authorization.js';
import { LoanerVehiclesService } from '../loaner-vehicles/loaner-vehicles.service.js';
import { DomainEventStoreService } from '../domain-event-store/domain-event-store.service.js';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto.js';
import { WorkshopScheduleService } from './workshop-schedule.service.js';
import {
  authorizeAndResolveCreateSite,
  validateCreateOrderInput,
  validateCreatePrerequisites,
} from './workshop-intake-create.helpers.js';
import { executeCreateOrder } from './workshop-intake-insert.helpers.js';
import { generateNextWorkshopOrderNumber } from './workshop-intake-number.helpers.js';
import { normalizeWorkshopBookingPackage } from './workshop-booking-package.schema.js';
import { WorkshopPositionPlanService } from './workshop-position-plan.service.js';

export const POSITION_PLAN_EXECUTOR_REQUIRED =
  'POSITION_PLAN_EXECUTOR_REQUIRED';

export type WorkshopBookingPackageResult = {
  id: string;
  entityId: string;
  workshop_order_id: string;
  loaner_booking_id?: string;
};

@Injectable()
export class WorkshopBookingPackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly scheduleService: WorkshopScheduleService,
    private readonly loanerAuthorization: LoanerVehiclesAuthorization,
    private readonly loanerVehicles: LoanerVehiclesService,
    private readonly domainEventStore: DomainEventStoreService,
    private readonly positionPlan: WorkshopPositionPlanService,
  ) {}

  async enrichInput(input: unknown): Promise<unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return input;
    }
    const record = { ...(input as Record<string, unknown>) };
    if (!this.positionPlan.hasPlanContent(record)) {
      return record;
    }
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const recomputed = await this.positionPlan.resolvePlan(
      tenantId,
      siteId,
      record,
    );
    if (!recomputed) {
      return record;
    }
    record.position_plan = this.positionPlan.toPayloadPositionPlan(recomputed);
    return record;
  }

  async applyPackage(
    input: unknown,
    executionContext?: Record<string, unknown>,
  ): Promise<WorkshopBookingPackageResult> {
    const packageInput = normalizeWorkshopBookingPackage(input);
    const record =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};

    const tenantId = await this.tenantContext.getTenantId();
    const expectedSiteId =
      typeof executionContext?.site_id === 'string'
        ? executionContext.site_id
        : undefined;

    if (packageInput.loaner) {
      await this.loanerAuthorization.assertWriteAccess();
    }

    const dto: CreateWorkshopOrderDto = {
      customerId: packageInput.customerId,
      vehicleId: packageInput.vehicleId,
      purpose:
        (packageInput.purpose as WorkshopOrderPurpose | undefined) ??
        WorkshopOrderPurpose.CUSTOMER_REPAIR,
      status: WorkshopOrderStatus.SCHEDULED,
      bayId: packageInput.bayId,
      mechanicId: packageInput.mechanicId,
      scheduledStartAt: packageInput.scheduledStartAt,
      scheduledEndAt: packageInput.scheduledEndAt,
      notes: packageInput.notes,
      reportedIssue: packageInput.reportedIssue,
    };

    const siteId = await authorizeAndResolveCreateSite(
      {
        tenantContext: this.tenantContext,
        siteContext: this.siteContext,
      },
      dto,
      expectedSiteId,
    );

    const hasPlan = this.positionPlan.hasPlanContent(record);
    const storedPlan = this.positionPlan.parseStoredPlan(record);
    if (hasPlan && !storedPlan) {
      throw new ConflictException({
        code: PLAN_STALE,
        message: 'The position plan changed; submit a new review',
      });
    }
    if (
      storedPlan &&
      ((storedPlan.questions?.length ?? 0) > 0 || storedPlan.lines.length === 0)
    ) {
      throw new UnprocessableEntityException(
        'The position plan has unresolved lines; submit a new review after clarifying',
      );
    }
    const recomputedPlan = storedPlan
      ? await this.positionPlan.resolvePlan(tenantId, siteId, record, {
          forApplyStaleCheck: true,
        })
      : null;
    if (storedPlan) {
      this.positionPlan.assertStoredPlanMatches(storedPlan, recomputedPlan);
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

    const purpose = dto.purpose ?? WorkshopOrderPurpose.CUSTOMER_REPAIR;
    validateCreateOrderInput(dto, true);
    await validateCreatePrerequisites(this.prisma, tenantId, dto, purpose);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const order = await executeCreateOrder({
        tx,
        tenantId,
        siteId,
        dto,
        purpose,
        vehicleId: packageInput.vehicleId,
        isScheduled: true,
        scheduleService: this.scheduleService,
        domainEventStore: this.domainEventStore,
        generateOrderNumber: (client) =>
          generateNextWorkshopOrderNumber(client, tenantId),
      });

      if (recomputedPlan) {
        await this.positionPlan.applyPlanInTransaction(
          tx,
          tenantId,
          siteId,
          order.id,
          WorkshopOrderStatus.SCHEDULED,
          recomputedPlan,
        );
      }

      let loanerBookingId: string | undefined;
      if (packageInput.loaner) {
        const booking =
          await this.loanerVehicles.createReservedBookingInTransaction(tx, {
            tenantId,
            siteId,
            loanerVehicleId: packageInput.loaner.loanerVehicleId,
            customerId: packageInput.customerId,
            workshopOrderId: order.id,
            plannedFrom: packageInput.loaner.plannedFrom,
            plannedTo: packageInput.loaner.plannedTo,
          });
        loanerBookingId = booking.id;
      }

      return { orderId: order.id, loanerBookingId };
    });

    return {
      id: outcome.orderId,
      entityId: outcome.orderId,
      workshop_order_id: outcome.orderId,
      ...(outcome.loanerBookingId
        ? { loaner_booking_id: outcome.loanerBookingId }
        : {}),
    };
  }

  async buildExecutionContext(): Promise<Record<string, unknown>> {
    const siteId = await this.siteContext.getSiteId();
    const tenantId = await this.tenantContext.getTenantId();
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException('Active site not found');
    }
    return { site_id: siteId };
  }
}
