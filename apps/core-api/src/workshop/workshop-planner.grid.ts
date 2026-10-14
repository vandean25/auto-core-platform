import type { WorkshopHoliday, WorkshopOpeningHour } from '@prisma/client';
import type {
  PlannerBayDto,
  PlannerEmployeeAwayDto,
  PlannerGridResponseDto,
  PlannerHolidayDto,
} from './dto/workshop-planner.dto.js';
import type { WorkshopOpeningHourDto } from './dto/workshop-settings.dto.js';
import {
  buildPlannerBookings,
  type PlannerBookableOrder,
} from './workshop-planner.bookings.js';
import { effectiveHours } from './workshop-planner.hours.js';
import { eachLocalDate, formatUtcDate } from './workshop-planner.time.js';
import {
  windowOverlaps,
  type PlannerRange,
  type TimeWindow,
} from './workshop-planner.window.js';

export type PlannerGridSettings = {
  timezone: string;
  slot_minutes: number;
  openingHours: WorkshopOpeningHour[];
};

export type PlannerBayRow = { id: string; name: string; sort_order: number };

export type PlannerLeaveRow = {
  id: string;
  start_on: Date;
  end_on: Date;
  employee: { id: string; name: string };
};

export type PlannerGridInput = {
  settings: PlannerGridSettings;
  range: PlannerRange;
  bays: PlannerBayRow[];
  holidays: WorkshopHoliday[];
  leaveRequests: PlannerLeaveRow[];
  orders: PlannerBookableOrder[];
  todayWindow: TimeWindow;
};

/** Assembles the planner grid from already-loaded rows. Pure: no I/O and no clock. */
export function buildPlannerGrid(
  input: PlannerGridInput,
): PlannerGridResponseDto {
  const { settings, range, holidays } = input;
  const unscheduledWindow = windowOverlaps(input.todayWindow, range)
    ? input.todayWindow
    : null;
  return {
    timezone: settings.timezone,
    slotMinutes: settings.slot_minutes,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    bays: input.bays.map(toPlannerBay),
    openings: settings.openingHours.map(toOpeningDto),
    holidays: expandPlannerHolidays(
      eachLocalDate(range.from, range.to, settings.timezone),
      holidays,
      settings.openingHours,
    ),
    employeesAway: input.leaveRequests.map(toEmployeeAway),
    bookings: buildPlannerBookings(input.orders, unscheduledWindow),
  };
}

/** Holiday overlay for each local date that carries a holiday. */
export function expandPlannerHolidays(
  localDates: string[],
  holidays: WorkshopHoliday[],
  openings: WorkshopOpeningHour[],
): PlannerHolidayDto[] {
  return localDates.flatMap((date): PlannerHolidayDto[] => {
    const hours = effectiveHours(date, holidays, openings);
    if (!hours.holidayName) {
      return [];
    }
    return [
      {
        date,
        name: hours.holidayName,
        isClosed: hours.isClosed,
        openTime: hours.openTime,
        closeTime: hours.closeTime,
      },
    ];
  });
}

function toPlannerBay(bay: PlannerBayRow): PlannerBayDto {
  return { id: bay.id, name: bay.name, sortOrder: bay.sort_order };
}

function toOpeningDto(hour: WorkshopOpeningHour): WorkshopOpeningHourDto {
  return {
    weekday: hour.weekday,
    isClosed: hour.is_closed,
    openTime: hour.open_time,
    closeTime: hour.close_time,
  };
}

function toEmployeeAway(leave: PlannerLeaveRow): PlannerEmployeeAwayDto {
  return {
    employeeId: leave.employee.id,
    name: leave.employee.name,
    startOn: formatUtcDate(leave.start_on),
    endOn: formatUtcDate(leave.end_on),
    leaveId: leave.id,
  };
}
