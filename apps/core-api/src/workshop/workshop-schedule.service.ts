import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeRole, WorkshopOrderStatus, type Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import {
  formatLocalDate,
  zonedWallClockToUtc,
  parseHhMm,
  parseLocalDate,
} from './workshop-planner.time';
import { WorkshopPlannerService } from './workshop-planner.service';
import { WorkshopSettingsService } from './workshop-settings.service';

export type BookedWindow = {
  bayId: string;
  mechanicId: string | null;
  start: Date;
  end: Date;
};

const ACTIVE_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

@Injectable()
export class WorkshopScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly settingsService: WorkshopSettingsService,
    private readonly plannerService: WorkshopPlannerService,
  ) {}

  async assertCanBook(
    dto: CreateWorkshopOrderDto,
    excludeOrderId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<BookedWindow> {
    if (dto.status !== WorkshopOrderStatus.SCHEDULED) {
      throw new BadRequestException('assertCanBook is for SCHEDULED orders');
    }
    if (!dto.bayId || !dto.scheduledStartAt || !dto.scheduledEndAt) {
      throw new BadRequestException(
        'SCHEDULED orders require bayId, scheduledStartAt, and scheduledEndAt',
      );
    }

    const start = new Date(dto.scheduledStartAt);
    const end = new Date(dto.scheduledEndAt);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      throw new BadRequestException(
        'scheduledEndAt must be after scheduledStartAt',
      );
    }

    const tenantId = await this.tenantContext.getTenantId();
    const db = tx ?? this.prisma;
    const bay = await db.bay.findFirst({
      where: { id: dto.bayId, tenant_id: tenantId, is_active: true },
    });
    if (!bay) {
      throw new NotFoundException(`Bay ${dto.bayId} not found`);
    }

    const mechanicId: string | null = dto.mechanicId ?? null;
    if (mechanicId) {
      const mechanic = await db.employee.findFirst({
        where: {
          id: mechanicId,
          tenant_id: tenantId,
          is_active: true,
          role: EmployeeRole.MECHANIC,
        },
      });
      if (!mechanic) {
        throw new BadRequestException(
          'Mechanic must be an active MECHANIC employee',
        );
      }
    }

    await this.assertBayFree({
      db,
      tenantId,
      bayId: dto.bayId,
      start,
      end,
      excludeOrderId,
    });

    return { bayId: dto.bayId, mechanicId, start, end };
  }

  private async assertBayFree(input: {
    db: Prisma.TransactionClient | PrismaService;
    tenantId: string;
    bayId: string;
    start: Date;
    end: Date;
    excludeOrderId?: string;
  }): Promise<void> {
    const occupying = await input.db.workshopOrder.findMany({
      where: {
        tenant_id: input.tenantId,
        bay_id: input.bayId,
        status: { in: ACTIVE_STATUSES },
        ...(input.excludeOrderId ? { id: { not: input.excludeOrderId } } : {}),
      },
      select: {
        id: true,
        order_number: true,
        status: true,
        scheduled_start_at: true,
        scheduled_end_at: true,
      },
    });

    const settings = await this.settingsService.getOrCreateSettings(
      input.tenantId,
    );
    const holidays = await input.db.workshopHoliday.findMany({
      where: { tenant_id: input.tenantId },
    });
    const todayLocal = formatLocalDate(new Date(), settings.timezone);
    const todayHours = this.plannerService.effectiveHours(
      todayLocal,
      holidays,
      settings.openingHours,
    );
    const { year, month, day } = parseLocalDate(todayLocal);
    const todayWindow =
      todayHours.isClosed || !todayHours.openTime || !todayHours.closeTime
        ? {
            start: zonedWallClockToUtc(
              settings.timezone,
              year,
              month,
              day,
              0,
              0,
            ),
            end: zonedWallClockToUtc(
              settings.timezone,
              year,
              month,
              day + 1,
              0,
              0,
            ),
          }
        : {
            start: zonedWallClockToUtc(
              settings.timezone,
              year,
              month,
              day,
              parseHhMm(todayHours.openTime).hour,
              parseHhMm(todayHours.openTime).minute,
            ),
            end: zonedWallClockToUtc(
              settings.timezone,
              year,
              month,
              day,
              parseHhMm(todayHours.closeTime).hour,
              parseHhMm(todayHours.closeTime).minute,
            ),
          };

    for (const order of occupying) {
      const window =
        order.scheduled_start_at && order.scheduled_end_at
          ? { start: order.scheduled_start_at, end: order.scheduled_end_at }
          : order.status === WorkshopOrderStatus.INTAKE ||
              order.status === WorkshopOrderStatus.IN_PROGRESS
            ? todayWindow
            : null;
      if (!window) {
        continue;
      }
      if (window.start < input.end && window.end > input.start) {
        throw new ConflictException(
          `Bay is already occupied by ${order.order_number}`,
        );
      }
    }
  }
}
