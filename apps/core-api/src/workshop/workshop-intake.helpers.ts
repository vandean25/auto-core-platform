import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationStatus,
  Prisma,
  VehicleInventoryRole,
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
import type { RegisterIntakeDto } from './dto/register-intake.dto.js';
import type { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto.js';
import {
  assertOrderEditable,
  normalizeWorkshopOrder,
  type WorkshopOrderWithRelations,
} from './workshop-order.helpers.js';
import {
  assertActiveTargetSiteMembership,
  assertPersistedSiteId,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import {
  VEHICLE_IDENTITY_RESET,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
  stripVehicleIdentityResolutionState,
} from '../vehicle/vehicle-identity.util.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const SEARCH_LIMIT = 100;

export const LIVE_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

export const ORDER_WITH_RELATIONS = {
  customer: true,
  vehicle: true,
  tasks: {
    include: {
      line_items: true,
    },
  },
} as const;

export const ORDER_WITH_INVOICE_RELATIONS = {
  customer: true,
  vehicle: true,
  invoice: { select: { id: true, invoice_number: true } },
  tasks: {
    orderBy: { createdAt: 'asc' },
    include: {
      line_items: true,
    },
  },
} as const;

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

export interface UpdateExistingIntakeVehicleParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  existingVehicle: {
    id: string;
    plate: string | null;
    identity_resolution_generation: string | null;
    identity_resolution_token: string | null;
  };
  dto: RegisterIntakeDto;
  customerId: string;
  vin: string | null;
}

export interface CreateNewIntakeVehicleParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  dto: RegisterIntakeDto;
  customerId: string;
  vin: string | null;
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

export function resolveFindAllPagination(
  page?: number,
  pageSize?: number,
): { page: number; pageSize: number; skip: number } {
  const resolvedPage = page && page > 0 ? page : 1;
  const rawSize = pageSize && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
  const resolvedPageSize = Math.min(rawSize, MAX_PAGE_SIZE);
  const skip = (resolvedPage - 1) * resolvedPageSize;

  return {
    page: resolvedPage,
    pageSize: resolvedPageSize,
    skip,
  };
}

export function buildWorkshopOrderFindAllWhere(
  tenantId: string,
  siteId: string,
  search?: string,
): Prisma.WorkshopOrderWhereInput {
  if (!search) {
    return { tenant_id: tenantId, site_id: siteId };
  }

  return {
    tenant_id: tenantId,
    site_id: siteId,
    OR: [
      {
        order_number: { contains: search, mode: 'insensitive' },
      },
      { id: { contains: search, mode: 'insensitive' } },
      {
        customer: {
          OR: [
            {
              first_name: {
                contains: search,
                mode: 'insensitive',
              },
            },
            {
              last_name: { contains: search, mode: 'insensitive' },
            },
            {
              company_name: {
                contains: search,
                mode: 'insensitive',
              },
            },
          ],
        },
      },
      {
        vehicle: {
          OR: [
            { make: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
            { plate: { contains: search, mode: 'insensitive' } },
            { vin: { contains: search, mode: 'insensitive' } },
          ],
        },
      },
    ],
  };
}

export function buildWorkshopOrderOrderBy(
  sortField?: string,
  sortDirection: 'asc' | 'desc' = 'desc',
): Prisma.WorkshopOrderOrderByWithRelationInput {
  const resolvedField = sortField ?? 'createdAt';

  if (resolvedField === 'status') {
    return { status: sortDirection };
  }
  if (resolvedField === 'orderNo' || resolvedField === 'order_number') {
    return { order_number: sortDirection };
  }
  if (resolvedField === 'id') {
    return { id: sortDirection };
  }
  if (resolvedField === 'customer') {
    return { customer: { last_name: sortDirection } };
  }
  if (resolvedField === 'vehicle') {
    return { vehicle: { make: sortDirection } };
  }

  return { createdAt: sortDirection };
}

export function buildVehicleSearchWhere(
  tenantId: string,
  query: string,
): Prisma.VehicleWhereInput {
  return {
    tenant_id: tenantId,
    OR: [
      { vin: { contains: query, mode: 'insensitive' } },
      { plate: { contains: query, mode: 'insensitive' } },
      { make: { contains: query, mode: 'insensitive' } },
      { model: { contains: query, mode: 'insensitive' } },
    ],
  };
}

export function buildCustomerSearchWhere(
  tenantId: string,
  query: string,
): Prisma.CustomerWhereInput {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      query,
    );

  return {
    tenant_id: tenantId,
    OR: [
      ...(isUuid ? [{ id: { equals: query } }] : []),
      { first_name: { contains: query, mode: 'insensitive' } },
      { last_name: { contains: query, mode: 'insensitive' } },
      { company_name: { contains: query, mode: 'insensitive' } },
      { phone: { contains: query, mode: 'insensitive' } },
    ],
  };
}

export function pickClosestScheduledOrder<
  T extends { id: string; scheduled_start_at: Date | null },
>(orders: T[]): T {
  const now = Date.now();
  return [...orders].sort((left, right) => {
    const leftStart = left.scheduled_start_at?.getTime();
    const rightStart = right.scheduled_start_at?.getTime();
    if (leftStart == null && rightStart == null) return 0;
    if (leftStart == null) return 1;
    if (rightStart == null) return -1;
    return (
      Math.abs(leftStart - now) - Math.abs(rightStart - now) ||
      leftStart - rightStart
    );
  })[0];
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

export function validateStockPrepVehicle(vehicle: {
  inventory_role?: VehicleInventoryRole | null;
  stock_status?: VehicleStockStatus | null;
}): void {
  if (vehicle.inventory_role !== VehicleInventoryRole.USED) {
    throw new BadRequestException(
      'Stock prep requires a used dealer-stock vehicle',
    );
  }
  if (
    vehicle.stock_status !== VehicleStockStatus.IN_STOCK &&
    vehicle.stock_status !== VehicleStockStatus.RESERVED
  ) {
    throw new BadRequestException(
      'Stock prep requires the vehicle to be in stock',
    );
  }
}

export async function findLiveOrderForVehicle(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  vehicleId: string,
) {
  return tx.workshopOrder.findFirst({
    where: {
      tenant_id: tenantId,
      site_id: siteId,
      vehicle_id: vehicleId,
      status: { in: LIVE_ORDER_STATUSES },
    },
    select: { id: true, order_number: true },
  });
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
    if (!dto.customerId) {
      throw new BadRequestException('customerId is required');
    }
    const customer = await prisma.customer.findFirst({
      where: { id: dto.customerId, tenant_id: tenantId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    }
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

export async function computeCustomerId(
  prisma: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  dto: RegisterIntakeDto,
): Promise<string> {
  if (dto.customerId) {
    const exists = await prisma.customer.findFirst({
      where: { id: dto.customerId, tenant_id: tenantId },
    });
    if (!exists) {
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    }
    return dto.customerId;
  }

  if (dto.email) {
    const existingCustomer = await prisma.customer.findFirst({
      where: { tenant_id: tenantId, email: dto.email },
    });
    if (existingCustomer) {
      return existingCustomer.id;
    }
  }

  const customer = await prisma.customer.create({
    data: {
      tenant_id: tenantId,
      first_name: dto.firstName || '',
      last_name: dto.lastName || '',
      email: dto.email,
      phone: dto.phone,
      type: 'PRIVATE',
    },
  });
  return customer.id;
}

export async function updateExistingIntakeVehicle(
  params: UpdateExistingIntakeVehicleParams,
) {
  const { tx, tenantId, existingVehicle, dto, customerId, vin } = params;
  const identityChanged =
    normalizeVehicleIdentityValue(existingVehicle.plate) !==
    normalizeVehicleIdentityValue(dto.plate);
  const updated = await tx.vehicle.updateMany({
    where: {
      id: existingVehicle.id,
      tenant_id: tenantId,
      vin,
      plate: existingVehicle.plate,
      identity_resolution_generation:
        existingVehicle.identity_resolution_generation ?? null,
      identity_resolution_token:
        existingVehicle.identity_resolution_token ?? null,
    },
    data: {
      plate: dto.plate,
      customer_id: customerId,
      ...(identityChanged
        ? { ...VEHICLE_IDENTITY_RESET, identity_resolution_token: null }
        : {}),
    },
  });

  if (updated.count === 0) {
    throw new ConflictException(
      'Vehicle VIN or plate changed while registering intake; please retry',
    );
  }

  const vehicle = await tx.vehicle.findFirst({
    where: { id: existingVehicle.id, tenant_id: tenantId },
    include: { customer: true },
  });
  if (!vehicle) {
    throw new NotFoundException(`Vehicle ${existingVehicle.id} not found`);
  }
  return stripVehicleIdentityResolutionState(vehicle);
}

export async function createNewIntakeVehicle(
  params: CreateNewIntakeVehicleParams,
) {
  const { tx, tenantId, dto, customerId, vin } = params;
  try {
    const vehicle = await tx.vehicle.create({
      data: {
        tenant_id: tenantId,
        vin,
        plate: dto.plate,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        customer_id: customerId,
      },
      include: {
        customer: true,
      },
    });
    return stripVehicleIdentityResolutionState(vehicle);
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Vehicle was created by another intake; please retry',
      );
    }
    throw error;
  }
}

export async function resolveIntakeVehicle(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dto: RegisterIntakeDto,
  customerId: string,
) {
  const vin = normalizeVehicleIdentityValueOrNull(dto.vin);
  const existingVehicle =
    vin === null
      ? null
      : await tx.vehicle.findFirst({
          where: { tenant_id: tenantId, vin },
          select: {
            id: true,
            plate: true,
            identity_resolution_generation: true,
            identity_resolution_token: true,
          },
        });

  if (existingVehicle) {
    return updateExistingIntakeVehicle({
      tx,
      tenantId,
      existingVehicle,
      dto,
      customerId,
      vin,
    });
  }

  return createNewIntakeVehicle({
    tx,
    tenantId,
    dto,
    customerId,
    vin,
  });
}

export async function executeRegisterIntake(
  prisma: PrismaService,
  tenantId: string,
  dto: RegisterIntakeDto,
) {
  const customerId = await computeCustomerId(prisma, tenantId, dto);

  return prisma.$transaction(async (tx) => {
    return resolveIntakeVehicle(tx, tenantId, dto, customerId);
  });
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
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  returnLocationId: string | null,
  partsRequisitionService: Pick<PartsRequisitionService, 'releaseReservation'>,
): Promise<void> {
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

export function buildWorkshopOrderRetargetData(
  existing: {
    reported_issue: string | null;
    notes: string | null;
    mechanic_id: string | null;
    scheduled_start_at: Date | null;
    scheduled_end_at: Date | null;
  },
  dto: UpdateWorkshopOrderDto,
): Prisma.WorkshopOrderUpdateManyMutationInput {
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
    scheduled_start_at: dto.scheduledStartAt
      ? new Date(dto.scheduledStartAt)
      : existing.scheduled_start_at,
    scheduled_end_at: dto.scheduledEndAt
      ? new Date(dto.scheduledEndAt)
      : existing.scheduled_end_at,
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
): Prisma.WorkshopOrderUpdateManyMutationInput {
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

    await releaseOrderReservationsForRetarget(
      tx,
      tenantId,
      id,
      existing.staging_location_id,
      partsRequisitionService,
    );

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
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  id: string,
  dto: UpdateWorkshopOrderDto,
) {
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

  const isRetargeting =
    dto.siteId !== undefined && dto.siteId !== persistedSiteId;

  if (!isRetargeting && persistedSiteId !== activeSiteId) {
    throw new NotFoundException(`Workshop order ${id} not found`);
  }

  if (
    dto.expectedSiteId !== undefined &&
    dto.expectedSiteId !== persistedSiteId
  ) {
    throw new ConflictException(
      'Workshop order site changed concurrently. Please refresh.',
    );
  }

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

  const hasScheduleUpdate =
    dto.bayId !== undefined ||
    dto.scheduledStartAt !== undefined ||
    dto.scheduledEndAt !== undefined ||
    dto.mechanicId !== undefined;

  const currentSiteId = persistedSiteId;

  if (hasScheduleUpdate) {
    return executeRescheduleOrder({
      prisma: services.prisma,
      scheduleService: services.scheduleService,
      tenantId,
      siteId: currentSiteId,
      id,
      existing,
      dto,
    });
  }

  return executeBasicOrderUpdate(
    services.prisma,
    tenantId,
    currentSiteId,
    id,
    dto,
  );
}

export async function executeFindAllWorkshopOrders(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  params: {
    search?: string;
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
  },
) {
  const { page, pageSize, skip } = resolveFindAllPagination(
    params.page,
    params.pageSize,
  );
  const where = buildWorkshopOrderFindAllWhere(tenantId, siteId, params.search);
  const orderBy = buildWorkshopOrderOrderBy(
    params.sortField,
    params.sortDirection,
  );

  const [data, total] = await Promise.all([
    prisma.workshopOrder.findMany({
      where: { ...where, site_id: siteId },
      include: ORDER_WITH_RELATIONS,
      skip,
      take: pageSize,
      orderBy,
    }),
    prisma.workshopOrder.count({ where: { ...where, site_id: siteId } }),
  ]);

  return {
    data: data.map((order) =>
      normalizeWorkshopOrder(order as WorkshopOrderWithRelations),
    ),
    meta: {
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
    },
  };
}

export async function executeFindOneWorkshopOrder(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  id: string,
) {
  const order = await prisma.workshopOrder.findFirst({
    where: { id, tenant_id: tenantId, site_id: siteId },
    include: ORDER_WITH_INVOICE_RELATIONS,
  });

  if (!order) {
    throw new NotFoundException(`Workshop order ${id} not found`);
  }

  return normalizeWorkshopOrder(order);
}

export async function executeSearchWorkshop(
  prisma: PrismaService,
  tenantId: string,
  query: string,
) {
  const page = 1;
  const limit = SEARCH_LIMIT;
  const skip = (page - 1) * limit;

  const vehicleWhere = buildVehicleSearchWhere(tenantId, query);
  const customerWhere = buildCustomerSearchWhere(tenantId, query);

  const [vehicles, customers, vehicleTotal, customerTotal] = await Promise.all([
    prisma.vehicle.findMany({
      where: vehicleWhere,
      include: {
        customer: true,
      },
      skip,
      take: limit,
    }),
    prisma.customer.findMany({
      where: customerWhere,
      include: {
        vehicles: true,
      },
      skip,
      take: limit,
    }),
    prisma.vehicle.count({ where: vehicleWhere }),
    prisma.customer.count({ where: customerWhere }),
  ]);

  const total = vehicleTotal + customerTotal;

  return {
    data: {
      vehicles: vehicles.map(stripVehicleIdentityResolutionState),
      customers: customers.map((customer) => ({
        ...customer,
        vehicles: customer.vehicles?.map(stripVehicleIdentityResolutionState),
      })),
    },
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
