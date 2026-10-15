import { Injectable, NotFoundException } from '@nestjs/common';
import type { WorkshopHoliday, WorkshopOpeningHour } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  PlannerGridResponseDto,
  PlannerQueryDto,
} from './dto/workshop-planner.dto.js';
import { buildPlannerGrid } from './workshop-planner.grid.js';
import {
  effectiveHours as effectiveHoursForDate,
  type EffectiveHours,
} from './workshop-planner.hours.js';
import {
  plannerBayFilter,
  plannerLeaveFilter,
  plannerOrderFilter,
} from './workshop-planner.queries.js';
import { formatLocalDate } from './workshop-planner.time.js';
import {
  findWorkshopSlots,
  type WorkshopSlotCandidate,
} from './workshop-planner.slots.js';
import {
  parsePlannerRange,
  plannerLeaveBounds,
  syntheticWindow,
} from './workshop-planner.window.js';
import { WorkshopSettingsService } from './workshop-settings.service.js';

@Injectable()
export class WorkshopPlannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly settingsService: WorkshopSettingsService,
  ) {}

  async getPlanner(query: PlannerQueryDto): Promise<PlannerGridResponseDto> {
    const range = parsePlannerRange(query);
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const [bays, settings, holidays, orders] = await Promise.all([
      this.prisma.bay.findMany({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          ...plannerBayFilter(query.bayId),
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
          ...plannerOrderFilter(range, query.bayId),
        },
        include: { customer: true, vehicle: true, mechanic: true },
      }),
    ]);

    const timezone = settings.timezone;
    const leaveRequests = await this.prisma.leaveRequest.findMany({
      where: {
        tenant_id: tenantId,
        ...plannerLeaveFilter(plannerLeaveBounds(range, timezone)),
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
    const todayLocal = formatLocalDate(new Date(), timezone);
    const todayWindow = syntheticWindow(
      timezone,
      todayLocal,
      this.effectiveHours(todayLocal, holidays, settings.openingHours),
    );

    return buildPlannerGrid({
      settings,
      range,
      bays,
      holidays,
      leaveRequests,
      orders,
      todayWindow,
    });
  }

  effectiveHours(
    isoDate: string,
    holidays: WorkshopHoliday[],
    openings: WorkshopOpeningHour[],
  ): EffectiveHours {
    return effectiveHoursForDate(isoDate, holidays, openings);
  }

  async listAvailableSlots(input: {
    from: string;
    to: string;
    durationMinutes: number;
    bayId?: string;
  }): Promise<{
    timezone: string;
    slotMinutes: number;
    range: { from: string; to: string };
    durationMinutes: number;
    slots: WorkshopSlotCandidate[];
  }> {
    const range = parsePlannerRange({ from: input.from, to: input.to });
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const [bays, settings, holidays, orders] = await Promise.all([
      this.prisma.bay.findMany({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          ...plannerBayFilter(input.bayId),
        },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        select: { id: true, sort_order: true },
      }),
      this.settingsService.getSettingsForSite(tenantId, siteId),
      this.prisma.workshopHoliday.findMany({
        where: { tenant_id: tenantId, site_id: siteId },
      }),
      this.prisma.workshopOrder.findMany({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          ...plannerOrderFilter(range, input.bayId),
        },
        select: {
          id: true,
          order_number: true,
          status: true,
          bay_id: true,
          mechanic_id: true,
          mechanic: { select: { name: true } },
          customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              company_name: true,
            },
          },
          scheduled_start_at: true,
          scheduled_end_at: true,
          vehicle: {
            select: {
              id: true,
              make: true,
              model: true,
              year: true,
              plate: true,
            },
          },
        },
      }),
    ]);

    if (input.bayId && bays.length === 0) {
      throw new NotFoundException(`Bay ${input.bayId} not found`);
    }

    const slots = findWorkshopSlots({
      timeZone: settings.timezone,
      slotMinutes: settings.slot_minutes,
      range,
      durationMinutes: input.durationMinutes,
      bays,
      holidays,
      openingHours: settings.openingHours,
      orders,
      now: new Date(),
    });

    return {
      timezone: settings.timezone,
      slotMinutes: settings.slot_minutes,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      durationMinutes: input.durationMinutes,
      slots,
    };
  }
}
