import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto.js';
import type { WorkshopOrderWithRelations } from './workshop-order.helpers.js';
import {
  LIVE_ORDER_STATUSES,
  ORDER_WITH_RELATIONS,
} from './workshop-intake-query.helpers.js';
import { validateStockPrepVehicle } from './workshop-intake-vehicle.helpers.js';
import { executeCreateOrder } from './workshop-intake-insert.helpers.js';
import {
  assertCanCreatePickerlOrder,
  PICKERL_TASK_TITLE,
} from './workshop-pickerl.helpers.js';
import type { WorkshopIntakeServices } from './workshop-intake-update.helpers.js';

export function validateCreateOrderInput(
  dto: CreateWorkshopOrderDto,
  isScheduled: boolean,
): void {
  if (
    !isScheduled &&
    (dto.odometer === undefined || dto.fuelLevel === undefined)
  ) {
    throw new BadRequestException('odometer and fuelLevel are required');
  }
}

async function validateCustomerPrerequisite(
  prisma: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  customerId?: string,
): Promise<void> {
  if (!customerId) {
    throw new BadRequestException('customerId is required');
  }
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenant_id: tenantId },
  });
  if (!customer) {
    throw new NotFoundException(`Customer ${customerId} not found`);
  }
}

export async function validateCreatePrerequisites(
  prisma: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  dto: CreateWorkshopOrderDto,
  purpose: WorkshopOrderPurpose,
) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: dto.vehicleId, tenant_id: tenantId },
  });
  if (!vehicle) {
    throw new NotFoundException(`Vehicle ${dto.vehicleId} not found`);
  }

  if (purpose === WorkshopOrderPurpose.CUSTOMER_REPAIR) {
    await validateCustomerPrerequisite(prisma, tenantId, dto.customerId);
  } else {
    validateStockPrepVehicle(vehicle);
  }

  return vehicle;
}

/**
 * An order created while the active site differs from the site the client simulated against is rejected
 * (422). Without an expected site, the active site is used.
 */
export function resolveCreateSiteId(
  activeSiteId: string,
  expectedSiteId?: string,
): string {
  if (expectedSiteId && activeSiteId !== expectedSiteId) {
    throw new UnprocessableEntityException(
      'Select the site where this action was simulated before applying it',
    );
  }
  return expectedSiteId ?? activeSiteId;
}

/**
 * The live order that already carries the §57a task for this vehicle, so a repeated request is idempotent.
 * Only a §57a request is checked; any other request returns null without querying.
 */
export async function findPickerlDuplicate(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  dto: CreateWorkshopOrderDto,
): Promise<WorkshopOrderWithRelations | null> {
  if (!dto.createPickerlTask) {
    return null;
  }
  return prisma.workshopOrder.findFirst({
    where: {
      tenant_id: tenantId,
      site_id: siteId,
      vehicle_id: dto.vehicleId,
      status: { in: LIVE_ORDER_STATUSES },
      tasks: { some: { title: PICKERL_TASK_TITLE } },
    },
    include: ORDER_WITH_RELATIONS,
  });
}

/**
 * A create that lost a race to a concurrent §57a request surfaces as a conflict; the order that won is returned.
 * Any other failure is not a duplicate, so it is left for the caller to rethrow.
 */
async function findPickerlDuplicateAfterConflict(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  dto: CreateWorkshopOrderDto,
  error: unknown,
): Promise<WorkshopOrderWithRelations | null> {
  if (!(error instanceof ConflictException)) {
    return null;
  }
  return findPickerlDuplicate(prisma, tenantId, siteId, dto);
}

export async function authorizeAndResolveCreateSite(
  services: {
    tenantContext: TenantContextService;
    siteContext: SiteContextService;
  },
  dto: CreateWorkshopOrderDto,
  expectedSiteId: string | undefined,
): Promise<string> {
  if (dto.createPickerlTask) {
    assertCanCreatePickerlOrder(
      services.tenantContext.getAuthenticatedUser()?.role,
    );
  }
  const activeSiteId = await services.siteContext.getSiteId();
  return resolveCreateSiteId(activeSiteId, expectedSiteId);
}

export async function executeCreateWorkshopOrder(
  services: Pick<
    WorkshopIntakeServices,
    | 'prisma'
    | 'tenantContext'
    | 'siteContext'
    | 'scheduleService'
    | 'domainEventStore'
    | 'requestContext'
  >,
  dto: CreateWorkshopOrderDto,
  generateOrderNumber: (tx: Prisma.TransactionClient) => Promise<string>,
  expectedSiteId?: string,
): Promise<WorkshopOrderWithRelations> {
  const tenantId = await services.tenantContext.getTenantId();
  const siteId = await authorizeAndResolveCreateSite(
    services,
    dto,
    expectedSiteId,
  );
  const purpose = dto.purpose ?? WorkshopOrderPurpose.CUSTOMER_REPAIR;
  const isScheduled = dto.status === WorkshopOrderStatus.SCHEDULED;

  validateCreateOrderInput(dto, isScheduled);
  const vehicle = await validateCreatePrerequisites(
    services.prisma,
    tenantId,
    dto,
    purpose,
  );

  const existingPickerlOrder = await findPickerlDuplicate(
    services.prisma,
    tenantId,
    siteId,
    dto,
  );
  if (existingPickerlOrder) {
    return existingPickerlOrder;
  }

  try {
    const traceId = services.requestContext.getTraceId();
    return await services.prisma.$transaction((tx) =>
      executeCreateOrder({
        tx,
        tenantId,
        siteId,
        dto,
        purpose,
        vehicleId: vehicle.id,
        isScheduled,
        scheduleService: services.scheduleService,
        generateOrderNumber,
        domainEventStore: services.domainEventStore,
        traceId,
        afterPromoteScheduledOrder: services.positionPlan
          ? (client, orderId) =>
              services.positionPlan!.fulfillDeferredReservationsOnIntake(
                client,
                tenantId,
                siteId,
                orderId,
              )
          : undefined,
      }),
    );
  } catch (error) {
    const duplicate = await findPickerlDuplicateAfterConflict(
      services.prisma,
      tenantId,
      siteId,
      dto,
      error,
    );
    if (duplicate) {
      return duplicate;
    }
    throw error;
  }
}
