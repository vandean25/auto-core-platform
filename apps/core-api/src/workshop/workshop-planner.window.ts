import { BadRequestException } from '@nestjs/common';
import type { EffectiveHours } from './workshop-planner.hours.js';
import {
  formatLocalDate,
  parseHhMm,
  parseLocalDate,
  zonedWallClockToUtc,
} from './workshop-planner.time.js';

const MAX_RANGE_MS = 8 * 24 * 60 * 60 * 1000;

export type PlannerRange = { from: Date; to: Date };
export type TimeWindow = { start: Date; end: Date };

/** Parses the planner query into a `[from, to)` range, rejecting empty or over-long windows. */
export function parsePlannerRange(query: {
  from?: string;
  to?: string;
}): PlannerRange {
  const from = parsePlannerInstant(query.from, 'from');
  const to = parsePlannerInstant(query.to, 'to');
  if (to.getTime() <= from.getTime()) {
    throw new BadRequestException('to must be after from');
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new BadRequestException('Planner range cannot exceed 8 days');
  }
  return { from, to };
}

function parsePlannerInstant(value: string | undefined, field: string): Date {
  if (!value) {
    throw new BadRequestException(`${field} is required`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be an ISO instant`);
  }
  return parsed;
}

/** Local calendar days at each edge of the range, as UTC midnights (leave dates are date-only). */
export function plannerLeaveBounds(
  range: PlannerRange,
  timeZone: string,
): { fromLocalDate: Date; toLocalDate: Date } {
  return {
    fromLocalDate: new Date(
      `${formatLocalDate(range.from, timeZone)}T00:00:00.000Z`,
    ),
    toLocalDate: new Date(
      `${formatLocalDate(new Date(range.to.getTime() - 1), timeZone)}T00:00:00.000Z`,
    ),
  };
}

export function windowOverlaps(span: TimeWindow, range: PlannerRange): boolean {
  return span.start < range.to && span.end > range.from;
}

/**
 * Bay occupancy span for one local day: the opening hours when open, otherwise the
 * whole local day so closed days still block the floor.
 */
export function syntheticWindow(
  timeZone: string,
  isoDate: string,
  hours: EffectiveHours,
): TimeWindow {
  const { year, month, day } = parseLocalDate(isoDate);
  if (hours.isClosed || !hours.openTime || !hours.closeTime) {
    return {
      start: zonedWallClockToUtc(timeZone, year, month, day, 0, 0),
      end: zonedWallClockToUtc(timeZone, year, month, day + 1, 0, 0),
    };
  }
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
