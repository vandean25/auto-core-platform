import type { WorkshopOrderStatus } from '@prisma/client';
import type {
  PlannerBookingDto,
  PlannerCustomerDto,
  PlannerVehicleDto,
} from './dto/workshop-planner.dto.js';
import type { TimeWindow } from './workshop-planner.window.js';

/** The order fields the planner renders, loaded with customer, vehicle and mechanic. */
export type PlannerBookableOrder = {
  id: string;
  order_number: string;
  status: WorkshopOrderStatus;
  bay_id: string | null;
  mechanic_id: string | null;
  mechanic: { name: string } | null;
  customer: {
    id: string;
    first_name: string;
    last_name: string;
    company_name: string | null;
  } | null;
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: number;
    plate: string | null;
  } | null;
  scheduled_start_at: Date | null;
  scheduled_end_at: Date | null;
};

type PlannerVehicleRow = NonNullable<PlannerBookableOrder['vehicle']>;
type BookableOrder = PlannerBookableOrder & {
  bay_id: string;
  vehicle: PlannerVehicleRow;
};

/**
 * One booking per order that has a bay and a vehicle: its scheduled slot when it has one,
 * otherwise the floor occupancy in `unscheduledWindow` (null when today is out of range).
 */
export function buildPlannerBookings(
  orders: PlannerBookableOrder[],
  unscheduledWindow: TimeWindow | null,
): PlannerBookingDto[] {
  return orders
    .filter(isBookable)
    .flatMap((order) => bookingForOrder(order, unscheduledWindow));
}

function isBookable(order: PlannerBookableOrder): order is BookableOrder {
  return Boolean(order.bay_id && order.vehicle);
}

function bookingForOrder(
  order: BookableOrder,
  unscheduledWindow: TimeWindow | null,
): PlannerBookingDto[] {
  if (order.scheduled_start_at && order.scheduled_end_at) {
    return [
      toPlannerBooking(order, 'BOOKING', {
        start: order.scheduled_start_at,
        end: order.scheduled_end_at,
      }),
    ];
  }
  if (!unscheduledWindow) {
    return [];
  }
  return [toPlannerBooking(order, 'UNSCHEDULED_ON_FLOOR', unscheduledWindow)];
}

function toPlannerBooking(
  order: BookableOrder,
  occupancyKind: PlannerBookingDto['occupancyKind'],
  span: TimeWindow,
): PlannerBookingDto {
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status as PlannerBookingDto['status'],
    occupancyKind,
    bayId: order.bay_id,
    mechanicId: order.mechanic_id,
    mechanicName: order.mechanic?.name ?? null,
    scheduledStartAt: span.start.toISOString(),
    scheduledEndAt: span.end.toISOString(),
    customer: toPlannerCustomer(order.customer),
    vehicle: toPlannerVehicle(order.vehicle),
  };
}

function toPlannerCustomer(
  customer: PlannerBookableOrder['customer'],
): PlannerCustomerDto | null {
  if (!customer) {
    return null;
  }
  return {
    id: customer.id,
    displayName:
      customer.company_name?.trim() ||
      `${customer.first_name} ${customer.last_name}`.trim(),
  };
}

function toPlannerVehicle(vehicle: PlannerVehicleRow): PlannerVehicleDto {
  return {
    id: vehicle.id,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    plate: vehicle.plate ?? undefined,
  };
}
