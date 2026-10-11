import { BadRequestException, Injectable } from '@nestjs/common';
import { WorkshopLineItemType, WorkshopOrderStatus } from '@prisma/client';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  WorkshopCapacityQueryDto,
  WorkshopCapacityWeekDto,
} from './dto/workshop-capacity.dto.js';
import {
  buildCapacityBays,
  buildCapacityDays,
  CAPACITY_DAY_COUNT,
  toCapacityOrderRow,
} from './workshop-capacity.helpers.js';
import { effectiveHours } from './workshop-planner.hours.js';
import {
  addIsoDays,
  formatLocalDate,
  isoMondayOnOrBefore,
  isValidIsoDate,
  parseLocalDate,
  zonedWallClockToUtc,
} from './workshop-planner.time.js';
import { WorkshopSettingsService } from './workshop-settings.service.js';

const ACTIVE_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];
const ON_FLOOR_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

/**
 * Read-only capacity grid for the active site: bays x days with planned labor
 * hours per order and the free hours left in each bay's working day.
 */
@Injectable()
export class WorkshopCapacityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly settingsService: WorkshopSettingsService,
  ) {}

  async getCapacityWeek(
    query: WorkshopCapacityQueryDto,
  ): Promise<WorkshopCapacityWeekDto> {
    if (query.weekStart !== undefined && !isValidIsoDate(query.weekStart)) {
      throw new BadRequestException('weekStart must be a real calendar date');
    }

    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const settings = await this.settingsService.getSettingsForSite(
      tenantId,
      siteId,
    );
    const timezone = settings.timezone;
    const today = formatLocalDate(new Date(), timezone);
    const weekStart = isoMondayOnOrBefore(query.weekStart ?? today);
    const dates = Array.from({ length: CAPACITY_DAY_COUNT }, (_, index) =>
      addIsoDays(weekStart, index),
    );
    const from = localMidnightUtc(timezone, weekStart);
    const to = localMidnightUtc(timezone, addIsoDays(weekStart, 7));

    const [bays, holidays, orders] = await Promise.all([
      this.prisma.bay.findMany({
        where: { tenant_id: tenantId, site_id: siteId, is_active: true },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, sort_order: true },
      }),
      this.prisma.workshopHoliday.findMany({
        where: { tenant_id: tenantId, site_id: siteId },
      }),
      this.prisma.workshopOrder.findMany({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          status: { in: ACTIVE_STATUSES },
          bay_id: { not: null },
          OR: [
            { scheduled_start_at: { gte: from, lt: to } },
            { scheduled_start_at: null, status: { in: ON_FLOOR_STATUSES } },
          ],
        },
        select: {
          id: true,
          order_number: true,
          status: true,
          bay_id: true,
          scheduled_start_at: true,
          vehicle: { select: { plate: true } },
          tasks: {
            where: { tenant_id: tenantId },
            select: {
              line_items: {
                where: {
                  tenant_id: tenantId,
                  type: WorkshopLineItemType.LABOR,
                },
                select: { quantity: true },
              },
            },
          },
        },
      }),
    ]);

    const dayInputs = dates.map((date) => ({
      date,
      hours: effectiveHours(date, holidays, settings.openingHours),
    }));
    const week = { timezone, today, dates };
    const orderRows = orders.flatMap((order) => {
      const row = toCapacityOrderRow(order, week);
      return row ? [row] : [];
    });

    return {
      timezone,
      today,
      weekStart,
      days: buildCapacityDays(dayInputs),
      bays: buildCapacityBays({
        bays: bays.map((bay) => ({
          id: bay.id,
          name: bay.name,
          sortOrder: bay.sort_order,
        })),
        days: dayInputs,
        orders: orderRows,
      }),
    };
  }
}

function localMidnightUtc(timeZone: string, isoDate: string): Date {
  const { year, month, day } = parseLocalDate(isoDate);
  return zonedWallClockToUtc(timeZone, year, month, day, 0, 0);
}
