import { Injectable } from '@nestjs/common';
import { WorkshopHoliday, WorkshopOpeningHour } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  isLeapYear,
  isoWeekdayFromUtcDate,
  parseLocalDate,
} from '../workshop/workshop-planner.time';
import { WorkshopSettingsService } from '../workshop/workshop-settings.service';

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

  async countChargeableDaysForTenant(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<{ daysCharged: number; timezone: string }> {
    const calendar = await this.loadTenantCalendar(tenantId);
    const daysCharged = this.countChargeableDays(
      from,
      to,
      calendar.timezone,
      calendar.openingHours,
      calendar.holidays,
    );
    return { daysCharged, timezone: calendar.timezone };
  }

  countChargeableDays(
    from: string,
    to: string,
    _timezone: string,
    hours: WorkshopOpeningHour[],
    holidays: WorkshopHoliday[],
  ): number {
    const dates = enumerateIsoDates(from, to);
    let charged = 0;

    for (const dateStr of dates) {
      const { year, month, day } = parseLocalDate(dateStr);

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
        return (
          obs.getUTCMonth() + 1 === month && obs.getUTCDate() === day
        );
      });

      const holiday = oneOff ?? annual;
      if (holiday) {
        if (!holiday.is_closed) {
          charged += 1;
        }
        continue;
      }

      const weekday = isoWeekdayFromUtcDate(year, month, day);
      const opening = hours.find((h) => h.weekday === weekday);
      const isClosed = opening?.is_closed ?? true;

      if (!isClosed) {
        charged += 1;
      }
    }

    return charged;
  }
}
