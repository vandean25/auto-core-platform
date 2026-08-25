import { Injectable } from '@nestjs/common';
import { WorkshopHoliday, WorkshopOpeningHour } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  isLeapYear,
  isoWeekdayFromUtcDate,
  parseLocalDate,
} from '../workshop/workshop-planner.time';
import { WorkshopSettingsService } from '../workshop/workshop-settings.service';
import { expectedMinutesForScheduleDay } from './hr-work-schedule.time';
import { HrWorkScheduleService } from './hr-work-schedule.service';

export interface TenantCalendarData {
  timezone: string;
  openingHours: WorkshopOpeningHour[];
  holidays: WorkshopHoliday[];
}

export function enumerateIsoDates(from: string, to: string): string[] {
  const dates: string[] = [];
  let current = from;
  while (current <= to) {
    dates.push(current);
    const { year, month, day } = parseLocalDate(current);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    current = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }
  return dates;
}

@Injectable()
export class HrWorkdayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: WorkshopSettingsService,
    private readonly scheduleService: HrWorkScheduleService,
  ) {}

  async loadTenantCalendar(tenantId: string): Promise<TenantCalendarData> {
    const [settings, holidays] = await Promise.all([
      this.settingsService.getOrCreateSettings(tenantId),
      this.prisma.workshopHoliday.findMany({
        where: { tenant_id: tenantId },
      }),
    ]);

    return {
      timezone: settings.timezone,
      openingHours: settings.openingHours,
      holidays,
    };
  }

  async countChargeableMinutesForTenant(
    tenantId: string,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<{ minutesCharged: number; timezone: string }> {
    const calendar = await this.loadTenantCalendar(tenantId);
    const minutesCharged = await this.countChargeableMinutes(
      tenantId,
      employeeId,
      from,
      to,
      calendar.timezone,
      calendar.openingHours,
      calendar.holidays,
    );
    return { minutesCharged, timezone: calendar.timezone };
  }

  async countChargeableMinutes(
    tenantId: string,
    employeeId: string,
    from: string,
    to: string,
    timezone: string,
    hours: WorkshopOpeningHour[],
    holidays: WorkshopHoliday[],
  ): Promise<number> {
    const dates = enumerateIsoDates(from, to);
    if (dates.length === 0) {
      return 0;
    }

    const schedules = await this.prisma.employeeWorkSchedule.findMany({
      where: {
        tenant_id: tenantId,
        employee_id: employeeId,
        effective_from: { lte: this.toDateOnly(dates[dates.length - 1]!) },
      },
      include: { days: true },
      orderBy: { effective_from: 'asc' },
    }) as Array<{
      effective_from: Date;
      days: Array<{
        weekday: number;
        is_working: boolean;
        start_time: string | null;
        end_time: string | null;
        break_minutes: number;
      }>;
    }>;

    let total = 0;
    for (const dateStr of dates) {
      total += this.chargeableMinutesForDate(
        dateStr,
        schedules,
        hours,
        holidays,
      );
    }
    return total;
  }

  private chargeableMinutesForDate(
    dateStr: string,
    schedules: Array<{
      effective_from: Date;
      days: Array<{
        weekday: number;
        is_working: boolean;
        start_time: string | null;
        end_time: string | null;
        break_minutes: number;
      }>;
    }>,
    hours: WorkshopOpeningHour[],
    holidays: WorkshopHoliday[],
  ): number {
    const schedule = this.resolveScheduleForDate(dateStr, schedules);
    if (!schedule) {
      return 0;
    }

    const { year, month, day } = parseLocalDate(dateStr);
    const weekday = isoWeekdayFromUtcDate(year, month, day);
    const dayRow = schedule.days.find((row) => row.weekday === weekday);
    if (!dayRow?.is_working) {
      return 0;
    }

    if (this.isShopFullyClosed(dateStr, year, month, day, hours, holidays)) {
      return 0;
    }

    return expectedMinutesForScheduleDay(dayRow);
  }

  private resolveScheduleForDate(
    dateStr: string,
    schedules: Array<{
      effective_from: Date;
      days: Array<{
        weekday: number;
        is_working: boolean;
        start_time: string | null;
        end_time: string | null;
        break_minutes: number;
      }>;
    }>,
  ) {
    const target = this.toDateOnly(dateStr).getTime();
    let resolved: (typeof schedules)[number] | undefined;
    for (const schedule of schedules) {
      if (schedule.effective_from.getTime() <= target) {
        resolved = schedule;
      } else {
        break;
      }
    }
    return resolved;
  }

  private isShopFullyClosed(
    dateStr: string,
    year: number,
    month: number,
    day: number,
    hours: WorkshopOpeningHour[],
    holidays: WorkshopHoliday[],
  ): boolean {
    const oneOff = holidays.find((h) => {
      if (h.repeats_annually) return false;
      return h.observed_on.toISOString().slice(0, 10) === dateStr;
    });

    const annual = holidays.find((h) => {
      if (!h.repeats_annually) return false;
      const obs = h.observed_on;
      if (obs.getUTCMonth() + 1 === 2 && obs.getUTCDate() === 29) {
        if (!isLeapYear(year)) return false;
      }
      return obs.getUTCMonth() + 1 === month && obs.getUTCDate() === day;
    });

    const holiday = oneOff ?? annual;
    if (holiday) {
      return holiday.is_closed;
    }

    const weekday = isoWeekdayFromUtcDate(year, month, day);
    const opening = hours.find((h) => h.weekday === weekday);
    return opening?.is_closed ?? true;
  }

  private toDateOnly(isoDate: string): Date {
    return new Date(`${isoDate}T00:00:00.000Z`);
  }
}
