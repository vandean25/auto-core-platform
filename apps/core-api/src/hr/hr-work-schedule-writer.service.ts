import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import { SiteContextService } from '../site/site-context.service.js';
import type {
  CreateEmployeeWorkScheduleDto,
  EmployeeWorkScheduleDayDto,
  EmployeeWorkScheduleVersionResponseDto,
  UpdateEmployeeWorkScheduleDto,
} from './dto/hr-work-schedule.dto.js';
import { HrIdentityService } from './hr-identity.service.js';
import {
  assertAuthorizedScheduleSite,
  assertScheduleEmployeeExists,
} from './hr-work-schedule.guards.js';
import {
  toScheduleDateOnly,
  toScheduleVersionResponse,
} from './hr-work-schedule.mapper.js';
import type { ScheduleWithDays } from './hr-work-schedule.types.js';
import { assertValidScheduleDays } from './hr-work-schedule.validation.js';

@Injectable()
export class HrWorkScheduleWriter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identityService: HrIdentityService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async createForEmployee(
    employeeId: string,
    dto: CreateEmployeeWorkScheduleDto,
  ): Promise<EmployeeWorkScheduleVersionResponseDto> {
    this.identityService.assertOwnerAdmin();
    assertValidScheduleDays(dto.days);

    const tenantId = await this.tenantContext.getTenantId();
    await assertScheduleEmployeeExists(this.prisma, employeeId, tenantId);
    await assertAuthorizedScheduleSite(this.siteContext, dto.siteId);

    try {
      const schedule = await this.prisma.$transaction((transaction) =>
        this.insertScheduleVersion(transaction, tenantId, employeeId, dto),
      );
      return toScheduleVersionResponse(schedule);
    } catch (error) {
      rethrowScheduleWriteError(error);
    }
  }

  async updateForEmployee(
    employeeId: string,
    scheduleId: string,
    dto: UpdateEmployeeWorkScheduleDto,
  ): Promise<EmployeeWorkScheduleVersionResponseDto> {
    this.identityService.assertOwnerAdmin();
    assertValidScheduleDays(dto.days);

    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.findScheduleOrThrow(
      employeeId,
      scheduleId,
      tenantId,
    );
    const targetSiteId = dto.siteId ?? existing.site_id;
    if (targetSiteId) {
      await assertAuthorizedScheduleSite(this.siteContext, targetSiteId);
    }

    try {
      const updated = await this.prisma.$transaction((transaction) =>
        this.replaceScheduleVersion(
          transaction,
          tenantId,
          scheduleId,
          dto,
          targetSiteId,
        ),
      );
      if (!updated) {
        throw new NotFoundException(`Work schedule ${scheduleId} not found`);
      }
      return toScheduleVersionResponse(updated);
    } catch (error) {
      rethrowScheduleWriteError(error);
    }
  }

  private async insertScheduleVersion(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    employeeId: string,
    dto: CreateEmployeeWorkScheduleDto,
  ): Promise<ScheduleWithDays> {
    await lockSitesAndAssertActive(transaction, tenantId, [dto.siteId]);
    const latest = await transaction.employeeWorkSchedule.findFirst({
      where: { tenant_id: tenantId, employee_id: employeeId },
      orderBy: { effective_from: 'desc' },
      select: { effective_from: true },
    });
    const effectiveFrom = toScheduleDateOnly(dto.effectiveFrom);
    if (latest && effectiveFrom <= latest.effective_from) {
      throw new ConflictException(
        'effectiveFrom must be later than the latest work schedule version.',
      );
    }

    return transaction.employeeWorkSchedule.create({
      data: {
        tenant_id: tenantId,
        employee_id: employeeId,
        site_id: dto.siteId,
        effective_from: effectiveFrom,
        days: { create: dto.days.map(toScheduleDayRow) },
      },
      include: { days: { orderBy: { weekday: 'asc' } } },
    });
  }

  private async replaceScheduleVersion(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    scheduleId: string,
    dto: UpdateEmployeeWorkScheduleDto,
    targetSiteId: string | null,
  ): Promise<ScheduleWithDays | null> {
    if (targetSiteId) {
      await lockSitesAndAssertActive(transaction, tenantId, [targetSiteId]);
    }
    await updateScheduleHeader(transaction, tenantId, scheduleId, dto.siteId);
    await transaction.employeeWorkScheduleDay.deleteMany({
      where: { tenant_id: tenantId, schedule_id: scheduleId },
    });
    await transaction.employeeWorkScheduleDay.createMany({
      data: dto.days.map((day) => ({
        tenant_id: tenantId,
        schedule_id: scheduleId,
        ...toScheduleDayRow(day),
      })),
    });

    return transaction.employeeWorkSchedule.findFirst({
      where: { id: scheduleId, tenant_id: tenantId },
      include: { days: { orderBy: { weekday: 'asc' } } },
    });
  }

  private async findScheduleOrThrow(
    employeeId: string,
    scheduleId: string,
    tenantId: string,
  ): Promise<ScheduleWithDays> {
    const existing = await this.prisma.employeeWorkSchedule.findFirst({
      where: { id: scheduleId, tenant_id: tenantId, employee_id: employeeId },
      include: { days: true },
    });
    if (!existing) {
      throw new NotFoundException(`Work schedule ${scheduleId} not found`);
    }
    return existing;
  }
}

function toScheduleDayRow(day: EmployeeWorkScheduleDayDto) {
  return {
    weekday: day.weekday,
    is_working: day.isWorking,
    start_time: day.startTime ?? null,
    end_time: day.endTime ?? null,
    break_minutes: day.breakMinutes,
  };
}

async function updateScheduleHeader(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  scheduleId: string,
  siteId: string | undefined,
): Promise<void> {
  try {
    await transaction.employeeWorkSchedule.update({
      where: { tenant_id_id: { tenant_id: tenantId, id: scheduleId } },
      data: {
        updatedAt: new Date(),
        ...(siteId ? { site_id: siteId } : {}),
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException(`Work schedule ${scheduleId} not found`);
    }
    throw error;
  }
}

function rethrowScheduleWriteError(error: unknown): never {
  if (prismaErrorCode(error) === 'P2002') {
    throw new ConflictException(
      'A work schedule already exists for this effectiveFrom.',
    );
  }
  throw error;
}

function prismaErrorCode(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  if (error && typeof error === 'object' && 'code' in error) {
    return error.code;
  }
  return undefined;
}
