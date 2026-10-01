import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationStatus,
  Prisma,
  VehicleStockStatus,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import type { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import type { WorkshopScheduleService } from './workshop-schedule.service.js';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto.js';
import type { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto.js';
import {
  assertOrderEditable,
  type WorkshopOrderWithRelations,
} from './workshop-order.helpers.js';
import {
  assertActiveTargetSiteMembership,
  assertPersistedSiteId,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import {
  findLiveOrderForVehicle,
  ORDER_WITH_INVOICE_RELATIONS,
  ORDER_WITH_RELATIONS,
  pickClosestScheduledOrder,
} from './workshop-intake-query.helpers.js';
import { validateStockPrepVehicle } from './workshop-intake-vehicle.helpers.js';

export * from './workshop-intake-query.helpers.js';
export * from './workshop-intake-vehicle.helpers.js';

export interface ExecuteCreateOrderParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  dto: CreateWorkshopOrderDto;
  purpose: WorkshopOrderPurpose;
  vehicleId: string;
  isScheduled: boolean;
  scheduleService: Pick<WorkshopScheduleService, 'assertCanBook'>;
  generateOrderNumber: (tx: Prisma.TransactionClient) => Promise<string>;
}

export interface InsertWorkshopOrderParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  dto: CreateWorkshopOrderDto;
  purpose: WorkshopOrderPurpose;
  booked: Awaited<ReturnType<WorkshopScheduleService['assertCanBook']>> | null;
  orderNumber: string;
}

export interface AssertOrderRetargetingPrerequisitesParams {
  prisma: PrismaService | Prisma.TransactionClient;
  tenantContext: TenantContextService;
  tenantId: string;
  existing: {
    status: WorkshopOrderStatus;
  };
  dto: UpdateWorkshopOrderDto;
}

export interface ExecuteUpdateOrderRetargetingParams {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  partsRequisitionService: Pick<PartsRequisitionService, 'releaseReservation'>;
  tenantId: string;
  id: string;
  existing: {
    site_id: string | null;
    status: WorkshopOrderStatus;
    staging_location_id: string | null;
    reported_issue: string | null;
    notes: string | null;
    mechanic_id: string | null;
    scheduled_start_at: Date | null;
    scheduled_end_at: Date | null;
  };
  persistedSiteId: string;
  dto: UpdateWorkshopOrderDto;
}

export interface ExecuteRescheduleOrderParams {
  prisma: PrismaService;
  scheduleService: Pick<WorkshopScheduleService, 'rescheduleOrder'>;
  tenantId: string;
  siteId: string;
  id: string;
  existing: {
    vehicle_id: string;
    bay_id: string | null;
    mechanic_id: string | null;
    scheduled_start_at: Date | null;
    scheduled_end_at: Date | null;
    status: WorkshopOrderStatus;
  };
  dto: UpdateWorkshopOrderDto;
}

export interface WorkshopIntakeServices {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  siteContext: SiteContextService;
  scheduleService: WorkshopScheduleService;
  partsRequisitionService: Pick<PartsRequisitionService, 'releaseReservation'>;
}

export interface ExecuteBasicOrderUpdateParams {
  prisma: PrismaService;
  tenantId: string;
  siteId: string;
  id: string;
  dto: UpdateWorkshopOrderDto;
}

export interface ReleaseOrderReservationsForRetargetParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  orderId: string;
  returnLocationId: string | null;
  partsRequisitionService: Pick<PartsRequisitionService, 'releaseReservation'>;
}

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

export async function assertNoLiveOrderForVehicle(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  vehicleId: string,
): Promise<void> {
  const live = await findLiveOrderForVehicle(tx, tenantId, siteId, vehicleId);
  if (live) {
    throw new ConflictException(
      `Vehicle already has active order ${live.order_number}`,
    );
  }
}

export async function tryPromoteScheduledOrder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  dto: CreateWorkshopOrderDto,
): Promise<WorkshopOrderWithRelations | null> {
  const scheduledOrders = await tx.workshopOrder.findMany({
    where: {
      tenant_id: tenantId,
      site_id: siteId,
      vehicle_id: dto.vehicleId,
      status: WorkshopOrderStatus.SCHEDULED,
    },
    select: {
      id: true,
      scheduled_start_at: true,
    },
  });
  if (scheduledOrders.length === 0) {
    return null;
  }

  const target = pickClosestScheduledOrder(scheduledOrders);
  const promoted = await tx.workshopOrder.updateMany({
    where: {
      id: target.id,
      tenant_id: tenantId,
      site_id: siteId,
      status: WorkshopOrderStatus.SCHEDULED,
    },
    data: {
      status: WorkshopOrderStatus.INTAKE,
      odometer: dto.odometer ?? 0,
      fuel_level: dto.fuelLevel ?? 0,
      reported_issue: dto.reportedIssue,
      notes: dto.notes,
    },
  });

  if (promoted.count === 0) {
    const live = await findLiveOrderForVehicle(
      tx,
      tenantId,
      siteId,
      dto.vehicleId,
    );
    if (live) {
      throw new ConflictException(
        `Vehicle already has active order ${live.order_number}`,
      );
    }
    return null;
  }

  const order = await tx.workshopOrder.findFirst({
    where: { id: target.id, tenant_id: tenantId, site_id: siteId },
    include: ORDER_WITH_RELATIONS,
  });
  if (!order) {
    throw new NotFoundException(
      `Workshop order ${target.id} not found after promote`,
    );
  }
  return order;
}

export async function reserveStockPrepVehicle(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vehicleId: string,
): Promise<void> {
  const flipped = await tx.vehicle.updateMany({
    where: {
      id: vehicleId,
      tenant_id: tenantId,
      stock_status: {
        in: [VehicleStockStatus.IN_STOCK, VehicleStockStatus.RESERVED],
      },
    },
    data: { stock_status: VehicleStockStatus.IN_PREP },
  });
  if (flipped.count === 0) {
    throw new ConflictException(
      'Vehicle is no longer available for stock prep',
    );
  }
}

export async function insertWorkshopOrder(
  params: InsertWorkshopOrderParams,
): Promise<WorkshopOrderWithRelations> {
  const { tx, tenantId, siteId, dto, purpose, booked, orderNumber } = params;
  return tx.workshopOrder.create({
    data: {
      tenant_id: tenantId,
      site_id: siteId,
      order_number: orderNumber,
      purpose,
      customer_id:
        purpose === WorkshopOrderPurpose.CUSTOMER_REPAIR
          ? dto.customerId
          : null,
      vehicle_id: dto.vehicleId,
      odometer: dto.odometer ?? 0,
      fuel_level: dto.fuelLevel ?? 0,
      reported_issue: dto.reportedIssue,
      notes: dto.notes,
      status: booked
        ? WorkshopOrderStatus.SCHEDULED
        : WorkshopOrderStatus.INTAKE,
      bay_id: booked?.bayId,
      mechanic_id: booked?.mechanicId,
      scheduled_start_at: booked?.start,
      scheduled_end_at: booked?.end,
    },
    include: ORDER_WITH_RELATIONS,
  });
}

export async function executeCreateOrder(
  params: ExecuteCreateOrderParams,
): Promise<WorkshopOrderWithRelations> {
  const {
    tx,
    tenantId,
    siteId,
    dto,
    purpose,
    vehicleId,
    isScheduled,
    scheduleService,
    generateOrderNumber,
  } = params;

  await lockSitesAndAssertActive(tx, tenantId, [siteId]);

  if (!isScheduled) {
    const promoted = await tryPromoteScheduledOrder(tx, tenantId, siteId, dto);
    if (promoted) {
      return promoted;
    }
  }
  await assertNoLiveOrderForVehicle(tx, tenantId, siteId, dto.vehicleId);

  if (purpose === WorkshopOrderPurpose.STOCK_PREP) {
    await reserveStockPrepVehicle(tx, tenantId, vehicleId);
  }

  const booked = isScheduled
    ? await scheduleService.assertCanBook(dto, undefined, tx)
    : null;

  const orderNumber = await generateOrderNumber(tx);
  return insertWorkshopOrder({
    tx,
    tenantId,
    siteId,
    dto,
    purpose,
    booked,
    orderNumber,
  });
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

export async function executeCreateWorkshopOrder(
  services: {
    prisma: PrismaService;
    tenantContext: TenantContextService;
    siteContext: SiteContextService;
    scheduleService: WorkshopScheduleService;
  },
  dto: CreateWorkshopOrderDto,
  generateOrderNumber: (tx: Prisma.TransactionClient) => Promise<string>,
): Promise<WorkshopOrderWithRelations> {
  const tenantId = await services.tenantContext.getTenantId();
  const siteId = await services.siteContext.getSiteId();
  const purpose = dto.purpose ?? WorkshopOrderPurpose.CUSTOMER_REPAIR;
  const isScheduled = dto.status === WorkshopOrderStatus.SCHEDULED;

  validateCreateOrderInput(dto, isScheduled);
  const vehicle = await validateCreatePrerequisites(
    services.prisma,
    tenantId,
    dto,
    purpose,
  );

  return services.prisma.$transaction((tx) =>
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
    }),
  );
}

export async function generateNextWorkshopOrderNumber(
  db: PrismaService | Prisma.TransactionClient,
  tenantId: string,
): Promise<string> {
  const currentYear = new Date().getFullYear();
  const prefix = `WO-${currentYear}-`;

  await db.financeSettings.upsert({
    where: { tenant_id: tenantId },
    update: {},
    create: {
      tenant_id: tenantId,
      fiscal_year_start_month: 1,
      lock_date: null,
      next_invoice_number: 1001,
      invoice_prefix: 'RE-2026-',
      next_sales_order_number: 1001,
      sales_order_prefix: 'SO-2026-',
      next_workshop_order_number: 1,
      workshop_order_prefix: prefix,
    },
  });

  const settings = await db.financeSettings.update({
    where: { tenant_id: tenantId },
    data: {
      next_workshop_order_number: { increment: 1 },
      workshop_order_prefix: prefix,
    },
    select: {
      next_workshop_order_number: true,
    },
  });

  const paddedSequence = String(
    settings.next_workshop_order_number - 1,
  ).padStart(4, '0');
  return `${prefix}${paddedSequence}`;
}

export async function releaseOrderReservationsForRetarget(
  params: ReleaseOrderReservationsForRetargetParams,
): Promise<void> {
  const { tx, tenantId, orderId, returnLocationId, partsRequisitionService } =
    params;
  const reservations = await tx.partsReservation.findMany({
    where: {
      tenant_id: tenantId,
      status: {
        in: [
          PartsReservationStatus.OPEN,
          PartsReservationStatus.ORDERED,
          PartsReservationStatus.STAGED,
        ],
      },
      workshop_task_line_item: {
        workshop_task: { workshop_order_id: orderId },
      },
    },
    select: { id: true },
  });

  for (const reservation of reservations) {
    await partsRequisitionService.releaseReservation(
      reservation.id,
      returnLocationId ? { returnLocationId } : {},
      tx,
    );
  }
}

function resolveNullableDate(
  value: string | undefined,
  fallback: Date | null,
): Date | null {
  return value ? new Date(value) : fallback;
}

export function buildWorkshopOrderRetargetData(
  existing: {
    reported_issue: string | null;
    notes: string | null;
    mechanic_id: string | null;
    scheduled_start_at: Date | null;
    scheduled_end_at: Date | null;
  },
  dto: UpdateWorkshopOrderDto,
): Prisma.WorkshopOrderUncheckedUpdateManyInput {
  return {
    site_id: dto.siteId,
    bay_id: dto.bayId,
    staging_location_id: null,
    reported_issue:
      dto.reportedIssue !== undefined
        ? dto.reportedIssue
        : existing.reported_issue,
    notes: dto.notes !== undefined ? dto.notes : existing.notes,
    mechanic_id:
      dto.mechanicId !== undefined ? dto.mechanicId : existing.mechanic_id,
    scheduled_start_at: resolveNullableDate(
      dto.scheduledStartAt,
      existing.scheduled_start_at,
    ),
    scheduled_end_at: resolveNullableDate(
      dto.scheduledEndAt,
      existing.scheduled_end_at,
    ),
  };
}

export function buildWorkshopOrderScheduleUpdateData(
  dto: UpdateWorkshopOrderDto,
  scheduleData: {
    bayId: string;
    mechanicId: string | null;
    start: Date;
    end: Date;
  },
): Prisma.WorkshopOrderUncheckedUpdateManyInput {
  return {
    reported_issue: dto.reportedIssue,
    notes: dto.notes,
    bay_id: scheduleData.bayId,
    mechanic_id: scheduleData.mechanicId,
    scheduled_start_at: scheduleData.start,
    scheduled_end_at: scheduleData.end,
  };
}

export async function assertOrderRetargetingPrerequisites(
  params: AssertOrderRetargetingPrerequisitesParams,
): Promise<void> {
  const { prisma, tenantContext, tenantId, existing, dto } = params;
  if (existing.status !== WorkshopOrderStatus.SCHEDULED) {
    throw new UnprocessableEntityException(
      'Workshop order site can only be changed while SCHEDULED',
    );
  }

  await assertActiveTargetSiteMembership(
    prisma,
    tenantContext,
    tenantId,
    dto.siteId!,
  );

  if (!dto.bayId) {
    throw new UnprocessableEntityException(
      'A bay on the target site is required when retargeting workshop order',
    );
  }

  const targetBay = await prisma.bay.findFirst({
    where: { id: dto.bayId, tenant_id: tenantId, site_id: dto.siteId! },
    select: { id: true },
  });
  if (!targetBay) {
    throw new UnprocessableEntityException(
      'A bay on the target site is required when retargeting workshop order',
    );
  }
}

export async function executeUpdateOrderRetargeting(
  params: ExecuteUpdateOrderRetargetingParams,
) {
  const {
    prisma,
    tenantContext,
    partsRequisitionService,
    tenantId,
    id,
    existing,
    persistedSiteId,
    dto,
  } = params;

  await assertOrderRetargetingPrerequisites({
    prisma,
    tenantContext,
    tenantId,
    existing,
    dto,
  });

  return prisma.$transaction(async (tx) => {
    await lockSitesAndAssertActive(tx, tenantId, [
      persistedSiteId,
      dto.siteId!,
    ]);

    await releaseOrderReservationsForRetarget({
      tx,
      tenantId,
      orderId: id,
      returnLocationId: existing.staging_location_id,
      partsRequisitionService,
    });

    const data = buildWorkshopOrderRetargetData(existing, dto);

    const updateResult = await tx.workshopOrder.updateMany({
      where: {
        id,
        tenant_id: tenantId,
        site_id: persistedSiteId,
        status: WorkshopOrderStatus.SCHEDULED,
        ...(dto.expectedSiteId ? { site_id: dto.expectedSiteId } : {}),
      },
      data,
    });

    if (updateResult.count === 0) {
      throw new ConflictException(
        'Workshop order state or site changed concurrently. Please refresh.',
      );
    }

    return tx.workshopOrder.findFirstOrThrow({
      where: { id, tenant_id: tenantId, site_id: dto.siteId },
      include: ORDER_WITH_INVOICE_RELATIONS,
    });
  });
}

export async function executeRescheduleOrder(
  params: ExecuteRescheduleOrderParams,
) {
  const { prisma, scheduleService, tenantId, siteId, id, existing, dto } =
    params;
  return prisma.$transaction(async (tx) => {
    const scheduleData = await scheduleService.rescheduleOrder(
      id,
      {
        vehicle_id: existing.vehicle_id,
        bay_id: existing.bay_id,
        mechanic_id: existing.mechanic_id,
        scheduled_start_at: existing.scheduled_start_at,
        scheduled_end_at: existing.scheduled_end_at,
        status: existing.status,
      },
      dto,
      tx,
    );

    const updateResult = await tx.workshopOrder.updateMany({
      where: { id, tenant_id: tenantId, site_id: siteId },
      data: buildWorkshopOrderScheduleUpdateData(dto, scheduleData),
    });
    if (updateResult.count === 0) {
      throw new NotFoundException(`Workshop order ${id} not found`);
    }

    return tx.workshopOrder.findFirstOrThrow({
      where: { id, tenant_id: tenantId, site_id: siteId },
      include: ORDER_WITH_INVOICE_RELATIONS,
    });
  });
}

export async function executeBasicOrderUpdate(
  params: ExecuteBasicOrderUpdateParams,
) {
  const { prisma, tenantId, siteId, id, dto } = params;
  const updateResult = await prisma.workshopOrder.updateMany({
    where: { id, tenant_id: tenantId, site_id: siteId },
    data: {
      reported_issue: dto.reportedIssue,
      notes: dto.notes,
    },
  });
  if (updateResult.count === 0) {
    throw new NotFoundException(`Workshop order ${id} not found`);
  }

  return prisma.workshopOrder.findFirstOrThrow({
    where: { id, tenant_id: tenantId, site_id: siteId },
    include: ORDER_WITH_INVOICE_RELATIONS,
  });
}

function isOrderRetargeting(
  dto: UpdateWorkshopOrderDto,
  persistedSiteId: string,
): boolean {
  return dto.siteId !== undefined && dto.siteId !== persistedSiteId;
}

function assertActiveSiteMatch(
  isRetargeting: boolean,
  persistedSiteId: string,
  activeSiteId: string,
  id: string,
): void {
  if (!isRetargeting && persistedSiteId !== activeSiteId) {
    throw new NotFoundException(`Workshop order ${id} not found`);
  }
}

function assertExpectedSiteMatch(
  expectedSiteId: string | undefined,
  persistedSiteId: string,
): void {
  if (expectedSiteId !== undefined && expectedSiteId !== persistedSiteId) {
    throw new ConflictException(
      'Workshop order site changed concurrently. Please refresh.',
    );
  }
}

function hasScheduleUpdateFields(dto: UpdateWorkshopOrderDto): boolean {
  return (
    dto.bayId !== undefined ||
    dto.scheduledStartAt !== undefined ||
    dto.scheduledEndAt !== undefined ||
    dto.mechanicId !== undefined
  );
}

export async function executeUpdateOrder(
  services: WorkshopIntakeServices,
  id: string,
  dto: UpdateWorkshopOrderDto,
): Promise<WorkshopOrderWithRelations> {
  const tenantId = await services.tenantContext.getTenantId();
  const activeSiteId = await services.siteContext.getSiteId();
  const authorizedSiteIds = await services.siteContext.listAuthorizedSiteIds();

  const existing = await services.prisma.workshopOrder.findFirst({
    where: { id, tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
    include: ORDER_WITH_INVOICE_RELATIONS,
  });
  if (!existing) {
    throw new NotFoundException(`Workshop order ${id} not found`);
  }
  assertOrderEditable(existing);
  const persistedSiteId = assertPersistedSiteId(
    existing.site_id,
    'Workshop order site ownership is required',
  );

  const isRetargeting = isOrderRetargeting(dto, persistedSiteId);
  assertActiveSiteMatch(isRetargeting, persistedSiteId, activeSiteId, id);
  assertExpectedSiteMatch(dto.expectedSiteId, persistedSiteId);

  if (isRetargeting) {
    return executeUpdateOrderRetargeting({
      prisma: services.prisma,
      tenantContext: services.tenantContext,
      partsRequisitionService: services.partsRequisitionService,
      tenantId,
      id,
      existing,
      persistedSiteId,
      dto,
    });
  }

  if (hasScheduleUpdateFields(dto)) {
    return executeRescheduleOrder({
      prisma: services.prisma,
      scheduleService: services.scheduleService,
      tenantId,
      siteId: persistedSiteId,
      id,
      existing,
      dto,
    });
  }

  return executeBasicOrderUpdate({
    prisma: services.prisma,
    tenantId,
    siteId: persistedSiteId,
    id,
    dto,
  });
}
