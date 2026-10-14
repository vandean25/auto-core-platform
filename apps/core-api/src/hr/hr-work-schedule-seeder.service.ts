import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { WorkshopSettingsService } from '../workshop/workshop-settings.service.js';
import { mapOpeningHoursToScheduleDays } from './hr-work-schedule.opening-hours.js';
import type {
  ScheduleDayInput,
  ScheduleWithDays,
} from './hr-work-schedule.types.js';

@Injectable()
export class HrWorkScheduleSeeder {
  constructor(private readonly settingsService: WorkshopSettingsService) {}

  async seedInitialSchedule(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    employeeId: string,
    effectiveFrom: Date,
  ): Promise<ScheduleWithDays> {
    const settings = await this.settingsService.getOrCreateSettings(tenantId);
    const dayInputs = mapOpeningHoursToScheduleDays(settings.openingHours);

    return this.createScheduleVersion(
      transaction,
      tenantId,
      employeeId,
      effectiveFrom,
      dayInputs,
    );
  }

  private async createScheduleVersion(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    employeeId: string,
    effectiveFrom: Date,
    days: ScheduleDayInput[],
  ): Promise<ScheduleWithDays> {
    return transaction.employeeWorkSchedule.create({
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
  }
}
