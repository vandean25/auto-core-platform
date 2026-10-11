import { BadRequestException, Injectable } from '@nestjs/common';
import {
  LeaveRequestStatus,
  WorkshopHoliday,
  WorkshopOpeningHour,
  WorkshopOrderStatus,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PlannerBookingDto,
  PlannerGridResponseDto,
  PlannerHolidayDto,
  PlannerQueryDto,
} from './dto/workshop-planner.dto.js';
import { WorkshopOpeningHourDto } from './dto/workshop-settings.dto.js';
import {
  effectiveHours as effectiveHoursForDate,
  type EffectiveHours,
} from './workshop-planner.hours.js';
import {
  eachLocalDate,
  formatLocalDate,
  formatUtcDate,
  parseHhMm,
  parseLocalDate,
  zonedWallClockToUtc,
} from './workshop-planner.time.js';
import { WorkshopSettingsService } from './workshop-settings.service.js';

const MAX_RANGE_MS = 8 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

@Injectable()
export class WorkshopPlannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly settingsService: WorkshopSettingsService,
  ) {}

  async getPlanner(query: PlannerQueryDto): Promise<PlannerGridResponseDto> {
    const from = this.parseInstant(query.from, 'from');
    const to = this.parseInstant(query.to, 'to');
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('to must be after from');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException('Planner range cannot exceed 8 days');
    }

    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const [bays, settings, holidays, orders] = await Promise.all([
      this.prisma.bay.findMany({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          is_active: true,
          ...(query.bayId ? { id: query.bayId } : {}),
        },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      }),
      this.settingsService.getSettingsForSite(tenantId, siteId),
      this.prisma.workshopHoliday.findMany({
        where: { tenant_id: tenantId, site_id: siteId },
      }),
      this.prisma.workshopOrder.findMany({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          status: { in: ACTIVE_STATUSES },
          bay_id: query.bayId ? query.bayId : { not: null },
          OR: [
            {
              scheduled_start_at: { lt: to },
              scheduled_end_at: { gt: from },
            },
            {
              scheduled_start_at: null,
              scheduled_end_at: null,
              status: {
                in: [
                  WorkshopOrderStatus.INTAKE,
                  WorkshopOrderStatus.IN_PROGRESS,
                ],
              },
            },
          ],
        },
        include: {
          customer: true,
          vehicle: true,
          mechanic: true,
        },
      }),
    ]);

    const timezone = settings.timezone;
    const fromLocalDate = new Date(
      `${formatLocalDate(from, timezone)}T00:00:00.000Z`,
    );
    const toLocalDate = new Date(
      `${formatLocalDate(new Date(to.getTime() - 1), timezone)}T00:00:00.000Z`,
    );
    const leaveRequests = await this.prisma.leaveRequest.findMany({
      where: {
        tenant_id: tenantId,
        status: LeaveRequestStatus.BOOKED,
        start_on: { lte: toLocalDate },
        end_on: { gte: fromLocalDate },
      },
      select: {
        id: true,
        employee_id: true,
        start_on: true,
        end_on: true,
        employee: { select: { id: true, name: true } },
      },
      orderBy: [{ start_on: 'asc' }, { employee_id: 'asc' }],
    });
    const localDates = eachLocalDate(from, to, timezone);
    const employeesAway = leaveRequests.map((leave) => ({
      employeeId: leave.employee.id,
      name: leave.employee.name,
      startOn: formatUtcDate(leave.start_on),
      endOn: formatUtcDate(leave.end_on),
      leaveId: leave.id,
    }));
    const expandedHolidays = this.expandHolidays(
      localDates,
      holidays,
      settings.openingHours,
    );
    const todayLocal = formatLocalDate(new Date(), timezone);
    const todayHours = this.effectiveHours(
      todayLocal,
      holidays,
      settings.openingHours,
    );
    const todayWindow = this.syntheticWindow(timezone, todayLocal, todayHours);
    const rangeIntersectsToday =
      todayWindow.start < to && todayWindow.end > from;

    const bookings = orders.flatMap((order) => {
      if (!order.bay_id || !order.vehicle) {
        return [];
      }
      if (order.scheduled_start_at && order.scheduled_end_at) {
        return [
          this.toBooking({
            order,
            occupancyKind: 'BOOKING',
            start: order.scheduled_start_at,
            end: order.scheduled_end_at,
          }),
        ];
      }
      if (!rangeIntersectsToday) {
        return [];
      }
      return [
        this.toBooking({
          order,
          occupancyKind: 'UNSCHEDULED_ON_FLOOR',
          start: todayWindow.start,
          end: todayWindow.end,
        }),
      ];
    });

    return {
      timezone,
      slotMinutes: settings.slot_minutes,
      range: { from: from.toISOString(), to: to.toISOString() },
      bays: bays.map((bay) => ({
        id: bay.id,
        name: bay.name,
        sortOrder: bay.sort_order,
      })),
      openings: settings.openingHours.map((hour): WorkshopOpeningHourDto => ({
        weekday: hour.weekday,
        isClosed: hour.is_closed,
        openTime: hour.open_time,
        closeTime: hour.close_time,
      })),
      holidays: expandedHolidays,
      employeesAway,
      bookings,
    };
  }

  effectiveHours(
    isoDate: string,
    holidays: WorkshopHoliday[],
    openings: WorkshopOpeningHour[],
  ): EffectiveHours {
    return effectiveHoursForDate(isoDate, holidays, openings);
  }

  private expandHolidays(
    localDates: string[],
    holidays: WorkshopHoliday[],
    openings: WorkshopOpeningHour[],
  ): PlannerHolidayDto[] {
    return localDates.flatMap((date) => {
      const hours = this.effectiveHours(date, holidays, openings);
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

  private syntheticWindow(
    timeZone: string,
    isoDate: string,
    hours: EffectiveHours,
  ): { start: Date; end: Date } {
    const { year, month, day } = parseLocalDate(isoDate);
    if (hours.isClosed || !hours.openTime || !hours.closeTime) {
      return {
        start: zonedWallClockToUtc(timeZone, year, month, day, 0, 0),
        end: zonedWallClockToUtc(timeZone, year, month, day + 1, 0, 0),
      };
    }
    const open = parseHhMm(hours.openTime);
    const close = parseHhMm(hours.closeTime);
    return {
      start: zonedWallClockToUtc(
        timeZone,
        year,
        month,
        day,
        open.hour,
        open.minute,
      ),
      end: zonedWallClockToUtc(
        timeZone,
        year,
        month,
        day,
        close.hour,
        close.minute,
      ),
    };
  }

  private parseInstant(value: string | undefined, field: string): Date {
    if (!value) {
      throw new BadRequestException(`${field} is required`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be an ISO instant`);
    }
    return parsed;
  }

  private toBooking(input: {
    order: {
      id: string;
      order_number: string;
      status: WorkshopOrderStatus;
      bay_id: string | null;
      mechanic_id: string | null;
      mechanic: { name: string } | null;
      customer: {
        id: string;
        first_name: string;
        last_name: string;
        company_name: string | null;
      } | null;
      vehicle: {
        id: string;
        make: string;
        model: string;
        year: number;
        plate: string | null;
      };
    };
    occupancyKind: PlannerBookingDto['occupancyKind'];
    start: Date;
    end: Date;
  }): PlannerBookingDto {
    const { order } = input;
    return {
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status as PlannerBookingDto['status'],
      occupancyKind: input.occupancyKind,
      bayId: order.bay_id as string,
      mechanicId: order.mechanic_id,
      mechanicName: order.mechanic?.name ?? null,
      scheduledStartAt: input.start.toISOString(),
      scheduledEndAt: input.end.toISOString(),
      customer: order.customer
        ? {
            id: order.customer.id,
            displayName:
              order.customer.company_name?.trim() ||
              `${order.customer.first_name} ${order.customer.last_name}`.trim(),
          }
        : null,
      vehicle: {
        id: order.vehicle.id,
        make: order.vehicle.make,
        model: order.vehicle.model,
        year: order.vehicle.year,
        plate: order.vehicle.plate ?? undefined,
      },
    };
  }
}
