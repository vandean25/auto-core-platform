import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatLocalDate } from '../workshop/workshop-planner.time.js';
import { WorkshopSettingsService } from '../workshop/workshop-settings.service.js';
import type { EmployeeWorkScheduleResponseDto } from './dto/hr-work-schedule.dto.js';
import {
  assertCanReadSchedules,
  assertScheduleEmployeeExists,
} from './hr-work-schedule.guards.js';
import {
  findCurrentSchedule,
  toScheduleDateOnly,
  toScheduleVersionResponse,
} from './hr-work-schedule.mapper.js';
import { averageExpectedMinutesPerWorkday } from './hr-work-schedule.time.js';
import type { ScheduleWithDays } from './hr-work-schedule.types.js';

@Injectable()
export class HrWorkScheduleReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: WorkshopSettingsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findForEmployee(
    employeeId: string,
  ): Promise<EmployeeWorkScheduleResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    assertCanReadSchedules(this.tenantContext.getAuthenticatedUser()?.role);
    await assertScheduleEmployeeExists(this.prisma, employeeId, tenantId);

    const [settings, history] = await Promise.all([
      this.settingsService.getOrCreateSettings(tenantId),
      this.prisma.employeeWorkSchedule.findMany({
        where: { tenant_id: tenantId, employee_id: employeeId },
        orderBy: { effective_from: 'asc' },
        include: { days: { orderBy: { weekday: 'asc' } } },
      }),
    ]);

    const today = formatLocalDate(new Date(), settings.timezone);
    const current = findCurrentSchedule(
      history,
      toScheduleDateOnly(today).getTime(),
    );
    return {
      current: current ? toScheduleVersionResponse(current) : null,
      history: history.map((schedule) => toScheduleVersionResponse(schedule)),
    };
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
        effective_from: { lte: toScheduleDateOnly(dateStr) },
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
}
