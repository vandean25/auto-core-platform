import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  VehicleStockStatus,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
} from '@prisma/client';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto.js';
import type { WorkshopScheduleService } from './workshop-schedule.service.js';
import type { WorkshopOrderWithRelations } from './workshop-order.helpers.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import {
  findLiveOrderForVehicle,
  ORDER_WITH_RELATIONS,
  pickClosestScheduledOrder,
} from './workshop-intake-query.helpers.js';
import { createPickerlTaskAndInspection } from './workshop-pickerl.helpers.js';
import type { DomainEventStoreService } from '../domain-event-store/domain-event-store.service.js';
import { appendWorkshopOrderScheduledDomainEvent } from './workshop-domain-event.helpers.js';
import { randomUUID } from 'node:crypto';

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
  domainEventStore?: DomainEventStoreService;
  traceId?: string;
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

/**
 * 409 for a vehicle that already has a live order. The body names the order so the intake dialog can link to it;
 * the global filter forwards `orderId` and `orderNumber` for this code only.
 */
export function vehicleHasActiveOrderConflict(order: {
  id: string;
  order_number: string;
}): ConflictException {
  return new ConflictException({
    code: 'VEHICLE_HAS_ACTIVE_ORDER',
    message: `Vehicle already has active order ${order.order_number}`,
    orderId: order.id,
    orderNumber: order.order_number,
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
    throw vehicleHasActiveOrderConflict(live);
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
      throw vehicleHasActiveOrderConflict(live);
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

/**
 * An unbooked order starts at intake without a bay, mechanic or slot; a booked one is scheduled into the slot.
 */
function resolveOrderScheduleFields(
  booked: InsertWorkshopOrderParams['booked'],
) {
  if (!booked) {
    return { status: WorkshopOrderStatus.INTAKE };
  }
  return {
    status: WorkshopOrderStatus.SCHEDULED,
    bay_id: booked.bayId,
    mechanic_id: booked.mechanicId,
    scheduled_start_at: booked.start,
    scheduled_end_at: booked.end,
  };
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
      ...resolveOrderScheduleFields(booked),
    },
    include: ORDER_WITH_RELATIONS,
  });
}

/**
 * Creates the §57a inspection task on the order when requested. The order is reloaded afterwards
 * so the caller receives the task graph; otherwise the order is returned as-is.
 */
export async function attachPickerlTaskIfRequested(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  order: WorkshopOrderWithRelations,
  createPickerlTask: boolean | undefined,
): Promise<WorkshopOrderWithRelations> {
  if (!createPickerlTask) {
    return order;
  }
  await createPickerlTaskAndInspection(tx, tenantId, order.id);
  return tx.workshopOrder.findFirstOrThrow({
    where: { id: order.id, tenant_id: tenantId, site_id: siteId },
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
    domainEventStore,
    traceId,
  } = params;

  await lockSitesAndAssertActive(tx, tenantId, [siteId]);

  if (!isScheduled) {
    const promoted = await tryPromoteScheduledOrder(tx, tenantId, siteId, dto);
    if (promoted) {
      return attachPickerlTaskIfRequested(
        tx,
        tenantId,
        siteId,
        promoted,
        dto.createPickerlTask,
      );
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
  const order = await insertWorkshopOrder({
    tx,
    tenantId,
    siteId,
    dto,
    purpose,
    booked,
    orderNumber,
  });
  if (isScheduled && booked && domainEventStore) {
    const occurredAt = booked.start;
    await appendWorkshopOrderScheduledDomainEvent(tx, domainEventStore, {
      tenantId,
      siteId,
      orderId: order.id,
      occurredAt,
      traceId: traceId ?? randomUUID(),
    });
  }
  return attachPickerlTaskIfRequested(
    tx,
    tenantId,
    siteId,
    order,
    dto.createPickerlTask,
  );
}
