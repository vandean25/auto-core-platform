import { Prisma } from '@prisma/client';
import type {
  WorkshopCapacityBayDto,
  WorkshopCapacityCellDto,
  WorkshopCapacityDayDto,
  WorkshopCapacityOrderDto,
  WorkshopCapacityOrderStatus,
} from './dto/workshop-capacity.dto.js';
import type { EffectiveHours } from './workshop-planner.hours.js';
import { formatLocalDate, parseHhMm } from './workshop-planner.time.js';

export const CAPACITY_DAY_COUNT = 6;

export type CapacityOrderRow = {
  orderId: string;
  orderNumber: string;
  status: WorkshopCapacityOrderStatus;
  occupancyKind: 'BOOKING' | 'UNSCHEDULED_ON_FLOOR';
  bayId: string;
  /** Site-local day the order's planned hours count against. */
  localDate: string;
  plate: string | null;
  plannedLaborHours: Prisma.Decimal;
  scheduledStartAt: Date | null;
};

export type CapacityBayInput = { id: string; name: string; sortOrder: number };
export type CapacityDayInput = { date: string; hours: EffectiveHours };

/** An active workshop order as read by the service (tenant- and site-filtered). */
export type CapacitySourceOrder = {
  id: string;
  order_number: string;
  status: string;
  bay_id: string | null;
  scheduled_start_at: Date | null;
  vehicle: { plate: string | null };
  /** LABOR line items only; the query filters the type. */
  tasks: { line_items: { quantity: Prisma.Decimal }[] }[];
};

export type CapacityWindow = {
  timezone: string;
  /** Site-local date of "now". */
  today: string;
  dates: readonly string[];
};

const ZERO = new Prisma.Decimal(0);

/** Hours a bay can work on a day: the open window, zero when closed. */
export function openWindowHours(hours: EffectiveHours): Prisma.Decimal {
  if (hours.isClosed || !hours.openTime || !hours.closeTime) {
    return ZERO;
  }
  const open = parseHhMm(hours.openTime);
  const close = parseHhMm(hours.closeTime);
  const minutes =
    close.hour * 60 + close.minute - (open.hour * 60 + open.minute);
  return new Prisma.Decimal(Math.max(0, minutes)).div(60);
}

export function buildCapacityDays(
  days: CapacityDayInput[],
): WorkshopCapacityDayDto[] {
  return days.map(({ date, hours }) => ({
    date,
    isClosed: hours.isClosed,
    openTime: hours.isClosed ? null : hours.openTime,
    closeTime: hours.isClosed ? null : hours.closeTime,
    capacityHours: roundHours(openWindowHours(hours)),
    holidayName: hours.holidayName ?? null,
  }));
}

/**
 * Bays as rows, days as columns. Orders for a bay/day that is not in the input
 * lists are dropped, so callers may pass the whole site's order set.
 */
export function buildCapacityBays(input: {
  bays: CapacityBayInput[];
  days: CapacityDayInput[];
  orders: CapacityOrderRow[];
}): WorkshopCapacityBayDto[] {
  const capacityByDate = new Map(
    input.days.map(({ date, hours }) => [date, openWindowHours(hours)]),
  );
  const ordersByCell = new Map<string, CapacityOrderRow[]>();
  for (const order of input.orders) {
    const key = cellKey(order.bayId, order.localDate);
    ordersByCell.set(key, [...(ordersByCell.get(key) ?? []), order]);
  }

  return input.bays.map((bay) => ({
    id: bay.id,
    name: bay.name,
    sortOrder: bay.sortOrder,
    days: input.days.map(({ date }) =>
      buildCapacityCell({
        date,
        capacity: capacityByDate.get(date) ?? ZERO,
        orders: [...(ordersByCell.get(cellKey(bay.id, date)) ?? [])].sort(
          compareOrders,
        ),
      }),
    ),
  }));
}

function buildCapacityCell(input: {
  date: string;
  capacity: Prisma.Decimal;
  orders: CapacityOrderRow[];
}): WorkshopCapacityCellDto {
  const booked = input.orders.reduce(
    (sum, order) => sum.plus(order.plannedLaborHours),
    ZERO,
  );
  const remaining = input.capacity.minus(booked);
  return {
    date: input.date,
    capacityHours: roundHours(input.capacity),
    bookedHours: roundHours(booked),
    freeHours: roundHours(remaining.isNegative() ? ZERO : remaining),
    isOverbooked: booked.greaterThan(input.capacity),
    orders: input.orders.map(toOrderDto),
  };
}

function toOrderDto(order: CapacityOrderRow): WorkshopCapacityOrderDto {
  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    status: order.status,
    occupancyKind: order.occupancyKind,
    plate: order.plate,
    plannedLaborHours: roundHours(order.plannedLaborHours),
    scheduledStartAt: order.scheduledStartAt?.toISOString() ?? null,
  };
}

/** Unscheduled work already on the floor first, then by planned start. */
function compareOrders(a: CapacityOrderRow, b: CapacityOrderRow): number {
  const aStart = a.scheduledStartAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bStart = b.scheduledStartAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (aStart === bStart) {
    return a.orderNumber.localeCompare(b.orderNumber);
  }
  return aStart - bStart;
}

function cellKey(bayId: string, date: string): string {
  return `${bayId}|${date}`;
}

/** Maps an order to its bay/day row; null when it has no bay or falls outside the week. */
export function toCapacityOrderRow(
  order: CapacitySourceOrder,
  week: CapacityWindow,
): CapacityOrderRow | null {
  if (!order.bay_id) {
    return null;
  }
  // Walk-ins without a planned time occupy the bay today, as on the planner.
  const scheduled = order.scheduled_start_at;
  const localDate = scheduled
    ? formatLocalDate(scheduled, week.timezone)
    : week.today;
  if (!week.dates.includes(localDate)) {
    return null;
  }
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status as WorkshopCapacityOrderStatus,
    occupancyKind: scheduled ? 'BOOKING' : 'UNSCHEDULED_ON_FLOOR',
    bayId: order.bay_id,
    localDate,
    plate: order.vehicle.plate,
    plannedLaborHours: sumPlannedLaborHours(order.tasks),
    scheduledStartAt: scheduled,
  };
}

function sumPlannedLaborHours(
  tasks: CapacitySourceOrder['tasks'],
): Prisma.Decimal {
  return tasks.reduce(
    (total, task) =>
      task.line_items.reduce(
        (taskTotal, item) => taskTotal.plus(item.quantity),
        total,
      ),
    ZERO,
  );
}

function roundHours(value: Prisma.Decimal): number {
  return value.toDecimalPlaces(2).toNumber();
}
