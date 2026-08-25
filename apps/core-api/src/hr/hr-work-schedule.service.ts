import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeWorkScheduleDay,
  Prisma,
  WorkshopOpeningHour,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { formatLocalDate } from '../workshop/workshop-planner.time';
import { WorkshopSettingsService } from '../workshop/workshop-settings.service';
import {
  averageExpectedMinutesPerWorkday,
  daysToMinutes,
  FALLBACK_AVG_WORKDAY_MINUTES,
} from './hr-work-schedule.time';
import {
  CreateEmployeeWorkScheduleDto,
  EmployeeWorkScheduleResponseDto,
  EmployeeWorkScheduleVersionResponseDto,
  UpdateEmployeeWorkScheduleDto,
} from './dto/hr-work-schedule.dto';
import { HrIdentityService } from './hr-identity.service';

export type ScheduleDayInput = Pick<
  EmployeeWorkScheduleDay,
  'weekday' | 'is_working' | 'start_time' | 'end_time' | 'break_minutes'
>;

export type ScheduleWithDays = {
  id: string;
  effective_from: Date;
  days: EmployeeWorkScheduleDay[];
  createdAt: Date;
  updatedAt: Date;
};

const DEFAULT_ANNUAL_LEAVE_DAYS = 25;

@Injectable()
export class HrWorkScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: WorkshopSettingsService,
    private readonly identityService: HrIdentityService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findForEmployee(
    employeeId: string,
  ): Promise<EmployeeWorkScheduleResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    this.assertCanRead();

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${employeeId} not found`);
    }

    const [settings, history] = await Promise.all([
      this.settingsService.getOrCreateSettings(tenantId),
      this.prisma.employeeWorkSchedule.findMany({
        where: { tenant_id: tenantId, employee_id: employeeId },
        orderBy: { effective_from: 'asc' },
        include: { days: { orderBy: { weekday: 'asc' } } },
      }),
    ]);

    const today = formatLocalDate(new Date(), settings.timezone);
    const todayDate = this.toDateOnly(today).getTime();
    let current: ScheduleWithDays | null = null;
    for (const schedule of history) {
      if (schedule.effective_from.getTime() <= todayDate) {
        current = schedule;
      }
    }

    return {
      current: current ? this.toVersionResponse(current) : null,
      history: history.map((schedule) => this.toVersionResponse(schedule)),
    };
  }

  async createForEmployee(
    employeeId: string,
    dto: CreateEmployeeWorkScheduleDto,
  ): Promise<EmployeeWorkScheduleVersionResponseDto> {
    this.identityService.assertOwnerAdmin();
    this.assertValidDays(dto.days);

    const tenantId = await this.tenantContext.getTenantId();
    await this.assertEmployeeExists(employeeId, tenantId);

    try {
      const schedule = await this.prisma.$transaction(async (transaction) => {
        const latest = await transaction.employeeWorkSchedule.findFirst({
          where: { tenant_id: tenantId, employee_id: employeeId },
          orderBy: { effective_from: 'desc' },
          select: { effective_from: true },
        });
        const effectiveFrom = this.toDateOnly(dto.effectiveFrom);
        if (latest && effectiveFrom <= latest.effective_from) {
          throw new ConflictException(
            'effectiveFrom must be later than the latest work schedule version.',
          );
        }

        return transaction.employeeWorkSchedule.create({
          data: {
            tenant_id: tenantId,
            employee_id: employeeId,
            effective_from: effectiveFrom,
            days: {
              create: dto.days.map((day) => ({
                weekday: day.weekday,
                is_working: day.isWorking,
                start_time: day.startTime ?? null,
                end_time: day.endTime ?? null,
                break_minutes: day.breakMinutes,
              })),
            },
          },
          include: { days: { orderBy: { weekday: 'asc' } } },
        });
      });
      return this.toVersionResponse(schedule);
    } catch (error) {
      this.rethrowScheduleWriteError(error);
    }
  }

  async updateForEmployee(
    employeeId: string,
    scheduleId: string,
    dto: UpdateEmployeeWorkScheduleDto,
  ): Promise<EmployeeWorkScheduleVersionResponseDto> {
    this.identityService.assertOwnerAdmin();
    this.assertValidDays(dto.days);

    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.employeeWorkSchedule.findFirst({
      where: {
        id: scheduleId,
        tenant_id: tenantId,
        employee_id: employeeId,
      },
      include: { days: true },
    });
    if (!existing) {
      throw new NotFoundException(`Work schedule ${scheduleId} not found`);
    }

    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        try {
          await transaction.employeeWorkSchedule.update({
            where: {
              tenant_id_id: {
                tenant_id: tenantId,
                id: scheduleId,
              },
            },
            data: { updatedAt: new Date() },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2025'
          ) {
            throw new NotFoundException(
              `Work schedule ${scheduleId} not found`,
            );
          }
          throw error;
        }

        await transaction.employeeWorkScheduleDay.deleteMany({
          where: { tenant_id: tenantId, schedule_id: scheduleId },
        });
        await transaction.employeeWorkScheduleDay.createMany({
          data: dto.days.map((day) => ({
            tenant_id: tenantId,
            schedule_id: scheduleId,
            weekday: day.weekday,
            is_working: day.isWorking,
            start_time: day.startTime ?? null,
            end_time: day.endTime ?? null,
            break_minutes: day.breakMinutes,
          })),
        });

        return transaction.employeeWorkSchedule.findFirst({
          where: { id: scheduleId, tenant_id: tenantId },
          include: { days: { orderBy: { weekday: 'asc' } } },
        });
      });
      if (!updated) {
        throw new NotFoundException(`Work schedule ${scheduleId} not found`);
      }
      return this.toVersionResponse(updated);
    } catch (error) {
      this.rethrowScheduleWriteError(error);
    }
  }

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
    return Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      is_working: false,
      start_time: null,
      end_time: null,
      break_minutes: 0,
    }));
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

  private async assertEmployeeExists(
    employeeId: string,
    tenantId: string,
  ): Promise<void> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${employeeId} not found`);
    }
  }

  private assertCanRead(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'SALES') {
      throw new ForbiddenException(
        'Schedule access is restricted to managers and SALES.',
      );
    }
  }

  private assertValidDays(days: CreateEmployeeWorkScheduleDto['days']): void {
    const weekdays = days.map((day) => day.weekday);
    if (
      days.length !== 7 ||
      new Set(weekdays).size !== 7 ||
      weekdays.some((weekday) => weekday < 1 || weekday > 7)
    ) {
      throw new BadRequestException(
        'days must include each weekday 1–7 exactly once',
      );
    }

    for (const day of days) {
      const startTime = day.startTime ?? null;
      const endTime = day.endTime ?? null;

      if (!day.isWorking) {
        if (startTime !== null || endTime !== null) {
          throw new BadRequestException(
            `Weekday ${day.weekday} must not have times when isWorking is false`,
          );
        }
        continue;
      }

      if (!startTime || !endTime) {
        throw new BadRequestException(
          `Weekday ${day.weekday} requires startTime and endTime`,
        );
      }

      const startMinutes = this.timeToMinutes(startTime);
      const endMinutes = this.timeToMinutes(endTime);
      const span = endMinutes - startMinutes;
      if (span <= 0) {
        throw new BadRequestException(
          `Weekday ${day.weekday} endTime must be after startTime`,
        );
      }
      if (day.breakMinutes >= span) {
        throw new BadRequestException(
          `Weekday ${day.weekday} breakMinutes must be less than the work window`,
        );
      }
    }
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private rethrowScheduleWriteError(error: unknown): never {
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;
    if (code === 'P2002') {
      throw new ConflictException(
        'A work schedule already exists for this effectiveFrom.',
      );
    }
    throw error;
  }

  private toVersionResponse(
    schedule: ScheduleWithDays,
  ): EmployeeWorkScheduleVersionResponseDto {
    return {
      id: schedule.id,
      effectiveFrom: schedule.effective_from.toISOString().slice(0, 10),
      days: schedule.days.map((day) => ({
        id: day.id,
        weekday: day.weekday,
        isWorking: day.is_working,
        startTime: day.start_time,
        endTime: day.end_time,
        breakMinutes: day.break_minutes,
      })),
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
    };
  }
}

export { FALLBACK_AVG_WORKDAY_MINUTES };
