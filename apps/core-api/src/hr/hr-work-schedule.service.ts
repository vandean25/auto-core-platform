import { Injectable } from '@nestjs/common';
import type { Prisma, WorkshopOpeningHour } from '@prisma/client';
import type {
  CreateEmployeeWorkScheduleDto,
  EmployeeWorkScheduleResponseDto,
  EmployeeWorkScheduleVersionResponseDto,
  UpdateEmployeeWorkScheduleDto,
} from './dto/hr-work-schedule.dto.js';
import { HrWorkScheduleReader } from './hr-work-schedule-reader.service.js';
import { HrWorkScheduleSeeder } from './hr-work-schedule-seeder.service.js';
import { HrWorkScheduleWriter } from './hr-work-schedule-writer.service.js';
import { mapOpeningHoursToScheduleDays } from './hr-work-schedule.opening-hours.js';
import {
  daysToMinutes,
  FALLBACK_AVG_WORKDAY_MINUTES,
} from './hr-work-schedule.time.js';
import type {
  ScheduleDayInput,
  ScheduleWithDays,
} from './hr-work-schedule.types.js';

export type { ScheduleDayInput, ScheduleWithDays };
export { FALLBACK_AVG_WORKDAY_MINUTES };

const DEFAULT_ANNUAL_LEAVE_DAYS = 25;

@Injectable()
export class HrWorkScheduleService {
  constructor(
    private readonly reader: HrWorkScheduleReader,
    private readonly writer: HrWorkScheduleWriter,
    private readonly seeder: HrWorkScheduleSeeder,
  ) {}

  findForEmployee(
    employeeId: string,
  ): Promise<EmployeeWorkScheduleResponseDto> {
    return this.reader.findForEmployee(employeeId);
  }

  createForEmployee(
    employeeId: string,
    dto: CreateEmployeeWorkScheduleDto,
  ): Promise<EmployeeWorkScheduleVersionResponseDto> {
    return this.writer.createForEmployee(employeeId, dto);
  }

  updateForEmployee(
    employeeId: string,
    scheduleId: string,
    dto: UpdateEmployeeWorkScheduleDto,
  ): Promise<EmployeeWorkScheduleVersionResponseDto> {
    return this.writer.updateForEmployee(employeeId, scheduleId, dto);
  }

  seedInitialSchedule(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    employeeId: string,
    effectiveFrom: Date,
  ): Promise<ScheduleWithDays> {
    return this.seeder.seedInitialSchedule(
      transaction,
      tenantId,
      employeeId,
      effectiveFrom,
    );
  }

  resolveScheduleForDate(
    tenantId: string,
    employeeId: string,
    dateStr: string,
  ): Promise<ScheduleWithDays> {
    return this.reader.resolveScheduleForDate(tenantId, employeeId, dateStr);
  }

  resolveCurrentSchedule(
    tenantId: string,
    employeeId: string,
    timezone: string,
  ): Promise<ScheduleWithDays> {
    return this.reader.resolveCurrentSchedule(tenantId, employeeId, timezone);
  }

  getCurrentAverageWorkdayMinutes(
    tenantId: string,
    employeeId: string,
    timezone: string,
  ): Promise<number> {
    return this.reader.getCurrentAverageWorkdayMinutes(
      tenantId,
      employeeId,
      timezone,
    );
  }

  defaultAnnualLeaveMinutes(avgMinutesPerWorkday: number): number {
    return daysToMinutes(DEFAULT_ANNUAL_LEAVE_DAYS, avgMinutesPerWorkday);
  }

  mapOpeningHoursToScheduleDays(
    openingHours: WorkshopOpeningHour[],
  ): ScheduleDayInput[] {
    return mapOpeningHoursToScheduleDays(openingHours);
  }
}
