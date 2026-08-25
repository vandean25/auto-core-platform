import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EmployeeWorkScheduleDay,
  Prisma,
  WorkshopOpeningHour,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatLocalDate } from '../workshop/workshop-planner.time';
import { WorkshopSettingsService } from '../workshop/workshop-settings.service';
import {
  averageExpectedMinutesPerWorkday,
  daysToMinutes,
  FALLBACK_AVG_WORKDAY_MINUTES,
} from './hr-work-schedule.time';

export type ScheduleDayInput = Pick<
  EmployeeWorkScheduleDay,
  'weekday' | 'is_working' | 'start_time' | 'end_time' | 'break_minutes'
>;

export type ScheduleWithDays = {
  id: string;
  effective_from: Date;
  days: EmployeeWorkScheduleDay[];
};

const DEFAULT_ANNUAL_LEAVE_DAYS = 25;

@Injectable()
export class HrWorkScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: WorkshopSettingsService,
  ) {}

  async seedInitialSchedule(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    employeeId: string,
    effectiveFrom: Date,
  ): Promise<ScheduleWithDays> {
    const settings = await this.settingsService.getOrCreateSettings(tenantId);
    const dayInputs = this.mapOpeningHoursToScheduleDays(settings.openingHours);

    return this.createScheduleVersion(
      transaction,
      tenantId,
      employeeId,
      effectiveFrom,
      dayInputs,
    );
  }

  async resolveScheduleForDate(
    tenantId: string,
    employeeId: string,
    dateStr: string,
  ): Promise<ScheduleWithDays> {
    const schedule = await this.prisma.employeeWorkSchedule.findFirst({
      where: {
        tenant_id: tenantId,
        employee_id: employeeId,
        effective_from: { lte: this.toDateOnly(dateStr) },
      },
      orderBy: { effective_from: 'desc' },
      include: { days: { orderBy: { weekday: 'asc' } } },
    });
    if (!schedule) {
      throw new BadRequestException(
        `No work schedule found for employee ${employeeId} on ${dateStr}`,
      );
    }
    return schedule;
  }

  async resolveCurrentSchedule(
    tenantId: string,
    employeeId: string,
    timezone: string,
  ): Promise<ScheduleWithDays> {
    const today = formatLocalDate(new Date(), timezone);
    return this.resolveScheduleForDate(tenantId, employeeId, today);
  }

  async getCurrentAverageWorkdayMinutes(
    tenantId: string,
    employeeId: string,
    timezone: string,
  ): Promise<number> {
    const schedule = await this.resolveCurrentSchedule(
      tenantId,
      employeeId,
      timezone,
    );
    return averageExpectedMinutesPerWorkday(schedule.days);
  }

  defaultAnnualLeaveMinutes(avgMinutesPerWorkday: number): number {
    return daysToMinutes(DEFAULT_ANNUAL_LEAVE_DAYS, avgMinutesPerWorkday);
  }

  mapOpeningHoursToScheduleDays(
    openingHours: WorkshopOpeningHour[],
  ): ScheduleDayInput[] {
    if (openingHours.length === 0) {
      return this.defaultScheduleDays();
    }

    const byWeekday = new Map(openingHours.map((hour) => [hour.weekday, hour]));
    return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
      const opening = byWeekday.get(weekday);
      const isWorking = opening ? !opening.is_closed : weekday <= 5;
      return {
        weekday,
        is_working: isWorking,
        start_time: isWorking ? (opening?.open_time ?? '07:30') : null,
        end_time: isWorking ? (opening?.close_time ?? '17:00') : null,
        break_minutes: 0,
      };
    });
  }

  private defaultScheduleDays(): ScheduleDayInput[] {
    return [
      { weekday: 1, is_working: true, start_time: '07:30', end_time: '17:00', break_minutes: 0 },
      { weekday: 2, is_working: true, start_time: '07:30', end_time: '17:00', break_minutes: 0 },
      { weekday: 3, is_working: true, start_time: '07:30', end_time: '17:00', break_minutes: 0 },
      { weekday: 4, is_working: true, start_time: '07:30', end_time: '17:00', break_minutes: 0 },
      { weekday: 5, is_working: true, start_time: '07:30', end_time: '17:00', break_minutes: 0 },
      { weekday: 6, is_working: true, start_time: '08:00', end_time: '12:00', break_minutes: 0 },
      { weekday: 7, is_working: false, start_time: null, end_time: null, break_minutes: 0 },
    ];
  }

  private async createScheduleVersion(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    employeeId: string,
    effectiveFrom: Date,
    days: ScheduleDayInput[],
  ): Promise<ScheduleWithDays> {
    const schedule = await transaction.employeeWorkSchedule.create({
      data: {
        tenant_id: tenantId,
        employee_id: employeeId,
        effective_from: effectiveFrom,
        days: {
          create: days.map((day) => ({
            weekday: day.weekday,
            is_working: day.is_working,
            start_time: day.start_time,
            end_time: day.end_time,
            break_minutes: day.break_minutes,
          })),
        },
      },
      include: { days: { orderBy: { weekday: 'asc' } } },
    });
    return schedule;
  }

  private toDateOnly(isoDate: string): Date {
    return new Date(`${isoDate}T00:00:00.000Z`);
  }
}

export { FALLBACK_AVG_WORKDAY_MINUTES };
