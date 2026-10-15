import type { WorkshopHoliday, WorkshopOpeningHour } from '@prisma/client';
import { WorkshopOrderStatus } from '@prisma/client';
import type { PlannerBookableOrder } from './workshop-planner.bookings.js';
import { effectiveHours } from './workshop-planner.hours.js';
import {
  eachLocalDate,
  formatLocalDate,
  parseHhMm,
  parseLocalDate,
  zonedWallClockToUtc,
} from './workshop-planner.time.js';
import {
  syntheticWindow,
  windowOverlaps,
  type PlannerRange,
  type TimeWindow,
} from './workshop-planner.window.js';

export type WorkshopSlotCandidate = {
  bayId: string;
  startAt: Date;
  endAt: Date;
};

export type FindWorkshopSlotsInput = {
  timeZone: string;
  slotMinutes: number;
  range: PlannerRange;
  durationMinutes: number;
  bays: { id: string; sort_order: number }[];
  holidays: WorkshopHoliday[];
  openingHours: WorkshopOpeningHour[];
  orders: PlannerBookableOrder[];
  now: Date;
};

const FLOOR_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

/** Half-open overlap: touching endpoints do not overlap. */
export function halfOpenOverlaps(a: TimeWindow, b: TimeWindow): boolean {
  return a.start < b.end && a.end > b.start;
}

function isBookable(
  order: PlannerBookableOrder,
): order is PlannerBookableOrder & { bay_id: string; vehicle: NonNullable<PlannerBookableOrder['vehicle']> } {
  return Boolean(order.bay_id && order.vehicle);
}

function occupancyForOrder(
  order: PlannerBookableOrder & { bay_id: string },
  todayWindow: TimeWindow,
  range: PlannerRange,
): TimeWindow | null {
  if (order.scheduled_start_at && order.scheduled_end_at) {
    return {
      start: order.scheduled_start_at,
      end: order.scheduled_end_at,
    };
  }
  if (!FLOOR_STATUSES.includes(order.status)) {
    return null;
  }
  if (windowOverlaps(todayWindow, range)) {
    return todayWindow;
  }
  return null;
}

function openingWindowForDay(
  timeZone: string,
  isoDate: string,
  holidays: WorkshopHoliday[],
  openingHours: WorkshopOpeningHour[],
): TimeWindow | null {
  const hours = effectiveHours(isoDate, holidays, openingHours);
  if (hours.isClosed) {
    return null;
  }
  if (!hours.openTime || !hours.closeTime) {
    return null;
  }
  const { year, month, day } = parseLocalDate(isoDate);
  const open = parseHhMm(hours.openTime);
  const close = parseHhMm(hours.closeTime);
  return {
    start: zonedWallClockToUtc(
      timeZone,
      year,
      month,
      day,
      open.hour,
      open.minute,
    ),
    end: zonedWallClockToUtc(
      timeZone,
      year,
      month,
      day,
      close.hour,
      close.minute,
    ),
  };
}

function intersectWindow(
  window: TimeWindow,
  range: PlannerRange,
): TimeWindow | null {
  const start = window.start > range.from ? window.start : range.from;
  const end = window.end < range.to ? window.end : range.to;
  if (end.getTime() <= start.getTime()) {
    return null;
  }
  return { start, end };
}

function slotFits(
  start: Date,
  durationMs: number,
  opening: TimeWindow,
  occupancies: TimeWindow[],
): boolean {
  const end = new Date(start.getTime() + durationMs);
  if (end.getTime() > opening.end.getTime()) {
    return false;
  }
  const candidate = { start, end };
  return !occupancies.some((occupied) => halfOpenOverlaps(candidate, occupied));
}

/**
 * Lists free bay windows of at least `durationMinutes` inside site opening hours,
 * aligned to `slotMinutes`, using the same occupancy rules as the planner grid.
 */
export function findWorkshopSlots(
  input: FindWorkshopSlotsInput,
): WorkshopSlotCandidate[] {
  const durationMs = input.durationMinutes * 60_000;
  const stepMs = input.slotMinutes * 60_000;
  if (durationMs <= 0 || stepMs <= 0) {
    return [];
  }

  const todayLocal = formatLocalDate(input.now, input.timeZone);
  const todayHours = effectiveHours(
    todayLocal,
    input.holidays,
    input.openingHours,
  );
  const todayWindow = syntheticWindow(
    input.timeZone,
    todayLocal,
    todayHours,
  );

  const occupanciesByBay = new Map<string, TimeWindow[]>();
  for (const order of input.orders) {
    if (!isBookable(order)) {
      continue;
    }
    const span = occupancyForOrder(order, todayWindow, input.range);
    if (!span) {
      continue;
    }
    const list = occupanciesByBay.get(order.bay_id) ?? [];
    list.push(span);
    occupanciesByBay.set(order.bay_id, list);
  }

  const localDates = eachLocalDate(
    input.range.from,
    input.range.to,
    input.timeZone,
  );
  const slots: WorkshopSlotCandidate[] = [];

  const sortedBays = [...input.bays].sort(
    (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
  );

  for (const bay of sortedBays) {
    const occupancies = occupanciesByBay.get(bay.id) ?? [];
    for (const isoDate of localDates) {
      const dayOpening = openingWindowForDay(
        input.timeZone,
        isoDate,
        input.holidays,
        input.openingHours,
      );
      if (!dayOpening) {
        continue;
      }
      const searchable = intersectWindow(dayOpening, input.range);
      if (!searchable) {
        continue;
      }
      let cursor = searchable.start.getTime();
      const lastStart = searchable.end.getTime() - durationMs;
      while (cursor <= lastStart) {
        const start = new Date(cursor);
        if (
          slotFits(start, durationMs, dayOpening, occupancies) &&
          start >= input.range.from &&
          new Date(cursor + durationMs) <= input.range.to
        ) {
          slots.push({
            bayId: bay.id,
            startAt: start,
            endAt: new Date(cursor + durationMs),
          });
        }
        cursor += stepMs;
      }
    }
  }

  slots.sort(
    (a, b) =>
      a.startAt.getTime() - b.startAt.getTime() ||
      a.bayId.localeCompare(b.bayId),
  );
  return slots;
}
