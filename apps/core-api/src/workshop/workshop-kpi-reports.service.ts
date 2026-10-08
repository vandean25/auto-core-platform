import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeRole,
  InvoiceStatus,
  Prisma,
  TransactionType,
  WorkshopLineItemType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { expectedMinutesForScheduleDay } from '../hr/hr-work-schedule.time.js';
import {
  averageDailyStockValue,
  calculateAvailableHours,
  calculatePartsTurnover,
  calculateProductivity,
  calculateUtilisation,
  localDateStartUtc,
  localDateForInstant,
  reportPeriodKey,
  splitLaborIntervalByPeriod,
} from './workshop-kpi-reports.math.js';
import type {
  WorkshopKpiReportQueryDto,
  WorkshopKpiReportResponseDto,
  WorkshopKpiReportRowDto,
} from './dto/workshop-kpi-reports.dto.js';

const DEFAULT_SLOW_MOVER_DAYS = 90;
const SLOW_MOVER_LIMIT = 10;
const MAX_REPORT_DAYS = 366;
const FINAL_INVOICE_STATUSES = [
  InvoiceStatus.FINALIZED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
];
type MetricAccumulator = {
  key: string;
  period: string;
  mechanicId: string | null;
  mechanicName: string | null;
  availableMinutes: number;
  clockedHours: Prisma.Decimal;
  soldHours: Prisma.Decimal;
  laborRevenue: Prisma.Decimal;
  partsRevenue: Prisma.Decimal;
  revenue: Prisma.Decimal;
  closedOrders: number;
  openEntries: number;
};

type ScheduleRecord = {
  employee_id: string;
  site_id: string | null;
  effective_from: Date;
  days: Array<{
    weekday: number;
    is_working: boolean;
    start_time: string | null;
    end_time: string | null;
    break_minutes: number;
  }>;
};

type ClosedLaborEntry = {
  employee_id: string;
  started_at: Date;
  ended_at: Date;
};

type InventoryBalance = {
  quantity: Prisma.Decimal;
  stockValue: Prisma.Decimal;
  unvaluedQuantity: Prisma.Decimal;
};

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  for (
    let current = start;
    current <= end;
    current.setUTCDate(current.getUTCDate() + 1)
  ) {
    dates.push(toIsoDate(current));
  }
  return dates;
}

function dateOnly(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function weekdayForDate(isoDate: string): number {
  const weekday = dateOnly(isoDate).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function isHolidayClosed(
  isoDate: string,
  holidays: Array<{
    observed_on: Date;
    repeats_annually: boolean;
    is_closed: boolean;
  }>,
): boolean {
  const [year, month, day] = isoDate.split('-').map(Number);
  const holiday = holidays.find((candidate) => {
    const monthMatches = candidate.observed_on.getUTCMonth() + 1 === month;
    const dayMatches = candidate.observed_on.getUTCDate() === day;
    if (!monthMatches || !dayMatches) return false;
    if (!candidate.repeats_annually) {
      return candidate.observed_on.getUTCFullYear() === year;
    }
    return !(month === 2 && day === 29 && !isLeapYear(year));
  });
  return holiday?.is_closed ?? false;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function leaveMinutesByEmployeeDate(
  leaveRequests: Array<{
    employee_id: string;
    start_on: Date;
    end_on: Date;
    minutes_charged: number;
  }>,
  schedules: ScheduleRecord[],
): Map<string, number> {
  const allocations = new Map<string, number>();
  for (const leave of leaveRequests) {
    const days = enumerateDates(
      toIsoDate(leave.start_on),
      toIsoDate(leave.end_on),
    )
      .map((date) => {
        const schedule = resolveSchedule(schedules, leave.employee_id, date);
        const scheduleDay = schedule?.days.find(
          (day) => day.weekday === weekdayForDate(date),
        );
        return {
          date,
          siteId: schedule?.site_id,
          minutes: scheduleDay ? expectedMinutesForScheduleDay(scheduleDay) : 0,
        };
      })
      .filter(
        (day) =>
          day.minutes > 0 && day.siteId !== null && day.siteId !== undefined,
      );
    const totalScheduledMinutes = days.reduce(
      (total, day) => total + day.minutes,
      0,
    );
    if (totalScheduledMinutes === 0) continue;
    for (const day of days) {
      const minutes = Math.min(
        day.minutes,
        (leave.minutes_charged * day.minutes) / totalScheduledMinutes,
      );
      const key = `${leave.employee_id}:${day.siteId}:${day.date}`;
      allocations.set(key, (allocations.get(key) ?? 0) + minutes);
    }
  }
  return allocations;
}

function resolveSchedule(
  schedules: ScheduleRecord[],
  employeeId: string,
  date: string,
) {
  const dateValue = dateOnly(date).getTime();
  let resolved: ScheduleRecord | undefined;
  for (const schedule of schedules) {
    if (schedule.employee_id !== employeeId) continue;
    if (schedule.effective_from.getTime() > dateValue) break;
    resolved = schedule;
  }
  return resolved;
}

function createAccumulator(
  key: string,
  period: string,
  mechanicId: string | null,
  mechanicName: string | null,
): MetricAccumulator {
  return {
    key,
    period,
    mechanicId,
    mechanicName,
    availableMinutes: 0,
    clockedHours: new Prisma.Decimal(0),
    soldHours: new Prisma.Decimal(0),
    laborRevenue: new Prisma.Decimal(0),
    partsRevenue: new Prisma.Decimal(0),
    revenue: new Prisma.Decimal(0),
    closedOrders: 0,
    openEntries: 0,
  };
}

function roundHours(minutes: number): Prisma.Decimal {
  return new Prisma.Decimal(minutes).dividedBy(60);
}

function rowFromAccumulator(value: MetricAccumulator): WorkshopKpiReportRowDto {
  const availableHours = roundHours(value.availableMinutes);
  const avgRevenue = value.closedOrders
    ? value.revenue.dividedBy(value.closedOrders)
    : null;
  return {
    key: value.key,
    period: value.period,
    mechanic_id: value.mechanicId,
    mechanic_name: value.mechanicName,
    available_hours: availableHours.toFixed(2),
    clocked_hours: value.clockedHours.toFixed(2),
    sold_hours: value.soldHours.toFixed(2),
    labor_net_revenue: value.laborRevenue.toFixed(2),
    parts_net_revenue: value.partsRevenue.toFixed(2),
    utilisation_percent:
      calculateUtilisation(value.clockedHours, availableHours)?.toFixed(2) ??
      null,
    productivity_percent:
      calculateProductivity(value.soldHours, value.clockedHours)?.toFixed(2) ??
      null,
    closed_orders: value.closedOrders,
    average_net_revenue_per_order: avgRevenue?.toFixed(2) ?? null,
    open_labor_entry_count: value.openEntries,
  };
}

function addHours(target: MetricAccumulator, hours: Prisma.Decimal): void {
  target.clockedHours = target.clockedHours.plus(hours);
}

function decimal(value: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return value ?? new Prisma.Decimal(0);
}

@Injectable()
export class WorkshopKpiReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async getReport(
    query: WorkshopKpiReportQueryDto,
  ): Promise<WorkshopKpiReportResponseDto> {
    const role = this.tenantContext.getAuthenticatedUser()?.role?.toUpperCase();
    if (!role || !['OWNER', 'ADMIN', 'SALES'].includes(role)) {
      throw new ForbiddenException(
        'Workshop KPI reports are not available for this role',
      );
    }
    if (query.from > query.to) {
      throw new BadRequestException('from must be on or before to');
    }
    const reportDays =
      (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000 + 1;
    if (reportDays > MAX_REPORT_DAYS) {
      throw new BadRequestException(
        `Workshop KPI report range cannot exceed ${MAX_REPORT_DAYS} calendar days`,
      );
    }
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    if (!authorizedSiteIds.includes(query.siteId)) {
      throw new NotFoundException('Workshop KPI report site not found');
    }
    const site = await this.prisma.site.findFirst({
      where: { id: query.siteId, tenant_id: tenantId, is_active: true },
      select: { id: true, timezone: true },
    });
    if (!site) {
      throw new NotFoundException('Workshop KPI report site not found');
    }

    const dates = enumerateDates(query.from, query.to);
    const rangeStart = localDateStartUtc(query.from, site.timezone);
    const rangeEnd = localDateStartUtc(this.nextDate(query.to), site.timezone);
    const [
      employees,
      schedules,
      leaveRequests,
      holidays,
      closedEntries,
      openEntries,
      invoices,
    ] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          tenant_id: tenantId,
          role: EmployeeRole.MECHANIC,
        },
        select: { id: true, name: true },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.employeeWorkSchedule.findMany({
        where: {
          tenant_id: tenantId,
        },
        include: { days: { where: { tenant_id: tenantId } } },
        orderBy: [{ employee_id: 'asc' }, { effective_from: 'asc' }],
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          tenant_id: tenantId,
          status: 'BOOKED',
          start_on: { lte: dateOnly(query.to) },
          end_on: { gte: dateOnly(query.from) },
        },
        select: {
          employee_id: true,
          start_on: true,
          end_on: true,
          minutes_charged: true,
        },
      }),
      this.prisma.workshopHoliday.findMany({
        where: { tenant_id: tenantId, site_id: query.siteId },
        select: { observed_on: true, repeats_annually: true, is_closed: true },
      }),
      this.prisma.laborEntry.findMany({
        where: {
          tenant_id: tenantId,
          started_at: { lt: rangeEnd },
          ended_at: { not: null, gt: rangeStart },
          workshop_task: {
            tenant_id: tenantId,
            workshop_order: { tenant_id: tenantId, site_id: query.siteId },
          },
        },
        select: { employee_id: true, started_at: true, ended_at: true },
      }),
      this.prisma.laborEntry.findMany({
        where: {
          tenant_id: tenantId,
          ended_at: null,
          started_at: { gte: rangeStart, lt: rangeEnd },
          workshop_task: {
            tenant_id: tenantId,
            workshop_order: { tenant_id: tenantId, site_id: query.siteId },
          },
        },
        select: { employee_id: true, started_at: true },
      }),
      this.prisma.invoice.findMany({
        where: {
          tenant_id: tenantId,
          site_id: query.siteId,
          status: { in: FINAL_INVOICE_STATUSES },
          date: { gte: rangeStart, lt: rangeEnd },
          workshop_order_id: { not: null },
          workshop_order: {
            is: { tenant_id: tenantId, site_id: query.siteId },
          },
        },
        select: {
          id: true,
          date: true,
          total_net: true,
          workshop_order: {
            select: {
              id: true,
              mechanic_id: true,
              tasks: {
                where: { tenant_id: tenantId },
                select: {
                  mechanic_id: true,
                  line_items: {
                    where: { tenant_id: tenantId },
                    select: {
                      type: true,
                      catalog_item_id: true,
                      description: true,
                      quantity: true,
                    },
                  },
                },
              },
            },
          },
          items: {
            where: { tenant_id: tenantId },
            select: {
              catalog_item_id: true,
              description: true,
              quantity: true,
              unit_price: true,
              line_total: true,
              revenue_group_name: true,
            },
          },
        },
      }),
    ]);

    const mechanics = new Map(
      employees.map((employee) => [employee.id, employee.name]),
    );
    const mechanicAccumulators = new Map(
      employees.map((employee) => [
        employee.id,
        createAccumulator(
          employee.id,
          `${query.from}–${query.to}`,
          employee.id,
          employee.name,
        ),
      ]),
    );
    const periodKeys = [
      ...new Set(
        dates.map((date) =>
          query.groupBy === 'mechanic'
            ? `${query.from}–${query.to}`
            : reportPeriodKey(date, query.groupBy),
        ),
      ),
    ];
    const periodAccumulators = new Map(
      periodKeys.map((period) => [
        period,
        createAccumulator(period, period, null, null),
      ]),
    );
    const getAccumulator = (employeeId: string, period: string) =>
      query.groupBy === 'mechanic'
        ? mechanicAccumulators.get(employeeId)
        : periodAccumulators.get(period);

    const schedulesByEmployee = schedules as ScheduleRecord[];
    const leaveAllocations = leaveMinutesByEmployeeDate(
      leaveRequests,
      schedulesByEmployee,
    );
    const employeesMissingSite = new Set<string>();
    const reportMechanicIds = new Set<string>();
    for (const employee of employees) {
      for (const date of dates) {
        const schedule = resolveSchedule(
          schedulesByEmployee,
          employee.id,
          date,
        );
        if (!schedule || !schedule.site_id) {
          employeesMissingSite.add(employee.id);
          continue;
        }
        if (schedule.site_id !== query.siteId) continue;
        reportMechanicIds.add(employee.id);
        const scheduleDay = schedule.days.find(
          (day) => day.weekday === weekdayForDate(date),
        );
        if (!scheduleDay) {
          throw new BadRequestException(
            `Work schedule for ${employee.name} is missing weekday data`,
          );
        }
        const scheduledMinutes = expectedMinutesForScheduleDay(scheduleDay);
        const leaveMinutes = Math.round(
          leaveAllocations.get(`${employee.id}:${query.siteId}:${date}`) ?? 0,
        );
        const available = calculateAvailableHours([
          {
            scheduledMinutes,
            approvedLeaveMinutes: leaveMinutes,
            workshopClosed: isHolidayClosed(date, holidays),
          },
        ]);
        const accumulator = getAccumulator(
          employee.id,
          query.groupBy === 'mechanic'
            ? `${query.from}–${query.to}`
            : reportPeriodKey(date, query.groupBy),
        );
        if (accumulator) {
          accumulator.availableMinutes += Number(available.mul(60).toFixed(0));
        }
      }
    }

    for (const entry of closedEntries as ClosedLaborEntry[]) {
      if (!mechanicAccumulators.has(entry.employee_id) || !entry.ended_at)
        continue;
      reportMechanicIds.add(entry.employee_id);
      const clippedStart = new Date(
        Math.max(entry.started_at.getTime(), rangeStart.getTime()),
      );
      const clippedEnd = new Date(
        Math.min(entry.ended_at.getTime(), rangeEnd.getTime()),
      );
      if (clippedEnd <= clippedStart) continue;
      if (query.groupBy === 'mechanic') {
        const minutes =
          (clippedEnd.getTime() - clippedStart.getTime()) / 60_000;
        const accumulator = mechanicAccumulators.get(entry.employee_id);
        if (accumulator)
          accumulator.clockedHours = accumulator.clockedHours.plus(
            new Prisma.Decimal(minutes).dividedBy(60),
          );
        continue;
      }
      const splits = splitLaborIntervalByPeriod(
        clippedStart,
        clippedEnd,
        site.timezone,
        query.groupBy,
      );
      for (const split of splits) {
        const accumulator = periodAccumulators.get(split.period);
        if (accumulator) addHours(accumulator, split.hours);
      }
    }

    for (const entry of openEntries) {
      if (!mechanicAccumulators.has(entry.employee_id)) continue;
      reportMechanicIds.add(entry.employee_id);
      const period =
        query.groupBy === 'mechanic'
          ? `${query.from}–${query.to}`
          : reportPeriodKey(
              localDateForInstant(entry.started_at, site.timezone),
              query.groupBy,
            );
      const accumulator = getAccumulator(entry.employee_id, period);
      if (accumulator) accumulator.openEntries += 1;
    }

    const distinctOrders = new Set<string>();
    let totalInvoiceSoldHours = new Prisma.Decimal(0);
    let totalLaborNetRevenue = new Prisma.Decimal(0);
    let totalPartsNetRevenue = new Prisma.Decimal(0);
    for (const invoice of invoices) {
      const order = invoice.workshop_order;
      if (!order) continue;
      distinctOrders.add(order.id);
      const period =
        query.groupBy === 'mechanic'
          ? `${query.from}–${query.to}`
          : reportPeriodKey(
              localDateForInstant(invoice.date, site.timezone),
              query.groupBy,
            );
      const laborByMechanic = new Map<string, Prisma.Decimal>();
      const lineTypes = new Map<string, WorkshopLineItemType>();
      for (const task of order.tasks) {
        const assignedMechanic = task.mechanic_id ?? order.mechanic_id;
        for (const line of task.line_items) {
          lineTypes.set(
            `${line.catalog_item_id ?? ''}|${line.description}|${line.quantity.toString()}`,
            line.type,
          );
        }
        if (!assignedMechanic || !mechanics.has(assignedMechanic)) continue;
        reportMechanicIds.add(assignedMechanic);
        const taskHours = task.line_items
          .filter((line) => line.type === WorkshopLineItemType.LABOR)
          .reduce(
            (total, line) => total.plus(line.quantity),
            new Prisma.Decimal(0),
          );
        laborByMechanic.set(
          assignedMechanic,
          (laborByMechanic.get(assignedMechanic) ?? new Prisma.Decimal(0)).plus(
            taskHours,
          ),
        );
      }
      const allocations = [...laborByMechanic.entries()];
      const assignedLaborHours = allocations.reduce(
        (total, [, hours]) => total.plus(hours),
        new Prisma.Decimal(0),
      );
      const lineTypesBySource = new Map<string, WorkshopLineItemType | null>();
      for (const task of order.tasks) {
        for (const line of task.line_items) {
          const sourceKey = `${line.catalog_item_id ?? ''}|${line.description}`;
          if (!lineTypesBySource.has(sourceKey)) {
            lineTypesBySource.set(sourceKey, line.type);
          } else if (lineTypesBySource.get(sourceKey) !== line.type) {
            lineTypesBySource.set(sourceKey, null);
          }
        }
      }
      let invoiceLaborRevenue = new Prisma.Decimal(0);
      let invoicePartsRevenue = new Prisma.Decimal(0);
      let invoiceSoldHours = new Prisma.Decimal(0);
      for (const item of invoice.items) {
        const sourceKey = `${item.catalog_item_id ?? ''}|${item.description}`;
        const lineType =
          lineTypes.get(`${sourceKey}|${item.quantity.toString()}`) ??
          lineTypesBySource.get(sourceKey) ??
          (item.revenue_group_name?.toLowerCase().includes('labor')
            ? WorkshopLineItemType.LABOR
            : WorkshopLineItemType.PART);
        const lineNet = item.line_total ?? item.quantity.mul(item.unit_price);
        if (lineType === WorkshopLineItemType.LABOR) {
          invoiceLaborRevenue = invoiceLaborRevenue.plus(lineNet);
          invoiceSoldHours = invoiceSoldHours.plus(item.quantity);
        } else {
          invoicePartsRevenue = invoicePartsRevenue.plus(lineNet);
        }
      }
      totalInvoiceSoldHours = totalInvoiceSoldHours.plus(invoiceSoldHours);
      totalLaborNetRevenue = totalLaborNetRevenue.plus(invoiceLaborRevenue);
      totalPartsNetRevenue = totalPartsNetRevenue.plus(invoicePartsRevenue);
      if (query.groupBy !== 'mechanic') {
        const accumulator = periodAccumulators.get(period);
        if (accumulator) {
          accumulator.soldHours = accumulator.soldHours.plus(invoiceSoldHours);
          accumulator.revenue = accumulator.revenue.plus(invoice.total_net);
          accumulator.laborRevenue =
            accumulator.laborRevenue.plus(invoiceLaborRevenue);
          accumulator.partsRevenue =
            accumulator.partsRevenue.plus(invoicePartsRevenue);
          accumulator.closedOrders += 1;
        }
        continue;
      }
      for (const [employeeId, soldHours] of allocations) {
        const accumulator = getAccumulator(employeeId, period);
        if (!accumulator) continue;
        const mechanicShare = assignedLaborHours.isZero()
          ? new Prisma.Decimal(1).dividedBy(allocations.length)
          : soldHours.dividedBy(assignedLaborHours);
        accumulator.soldHours = accumulator.soldHours.plus(
          invoiceSoldHours.mul(
            assignedLaborHours.isZero() ? new Prisma.Decimal(0) : mechanicShare,
          ),
        );
        accumulator.revenue = accumulator.revenue.plus(
          decimal(invoice.total_net).mul(mechanicShare),
        );
        accumulator.laborRevenue = accumulator.laborRevenue.plus(
          invoiceLaborRevenue.mul(mechanicShare),
        );
        accumulator.partsRevenue = accumulator.partsRevenue.plus(
          invoicePartsRevenue.mul(mechanicShare),
        );
        accumulator.closedOrders += 1;
      }
    }

    const entries =
      query.groupBy === 'mechanic'
        ? [...mechanicAccumulators.entries()]
            .filter(([employeeId]) => reportMechanicIds.has(employeeId))
            .map(([, accumulator]) => accumulator)
        : [...periodAccumulators.values()];
    const totals = entries.reduce(
      (total, row) => {
        total.availableMinutes += row.availableMinutes;
        total.clockedHours = total.clockedHours.plus(row.clockedHours);
        total.soldHours = total.soldHours.plus(row.soldHours);
        total.laborRevenue = total.laborRevenue.plus(row.laborRevenue);
        total.partsRevenue = total.partsRevenue.plus(row.partsRevenue);
        total.revenue = total.revenue.plus(row.revenue);
        total.closedOrders += row.closedOrders;
        total.openEntries += row.openEntries;
        return total;
      },
      createAccumulator('total', `${query.from}–${query.to}`, null, null),
    );
    const partsTurnover = await this.getPartsTurnover(
      tenantId,
      query.siteId,
      query.from,
      query.to,
      site.timezone,
      rangeStart,
      rangeEnd,
    );

    const totalRow = rowFromAccumulator(totals);
    totalRow.closed_orders = distinctOrders.size;
    totalRow.sold_hours = totalInvoiceSoldHours.toFixed(2);
    totalRow.productivity_percent =
      calculateProductivity(
        totalInvoiceSoldHours,
        totals.clockedHours,
      )?.toFixed(2) ?? null;
    totalRow.labor_net_revenue = totalLaborNetRevenue.toFixed(2);
    totalRow.parts_net_revenue = totalPartsNetRevenue.toFixed(2);
    const totalInvoiceRevenue = invoices.reduce(
      (total, invoice) => total.plus(invoice.total_net),
      new Prisma.Decimal(0),
    );
    totalRow.average_net_revenue_per_order = distinctOrders.size
      ? totalInvoiceRevenue.dividedBy(distinctOrders.size).toFixed(2)
      : null;
    return {
      data: entries.map(rowFromAccumulator),
      meta: {
        from: query.from,
        to: query.to,
        timezone: site.timezone,
        groupBy: query.groupBy,
        unassigned_mechanic_count: employeesMissingSite.size,
      },
      totals: totalRow,
      parts_turnover: partsTurnover,
    };
  }

  private async getPartsTurnover(
    tenantId: string,
    siteId: string,
    from: string,
    to: string,
    timeZone: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<WorkshopKpiReportResponseDto['parts_turnover']> {
    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        createdAt: { lt: rangeEnd },
      },
      select: {
        item_id: true,
        location_id: true,
        quantity: true,
        type: true,
        cost_basis: true,
        createdAt: true,
        seq: true,
      },
      orderBy: [{ createdAt: 'asc' }, { seq: 'asc' }],
    });
    const itemIds = [
      ...new Set(transactions.map((transaction) => transaction.item_id)),
    ];
    const catalogItems = await this.prisma.catalogItem.findMany({
      where: { tenant_id: tenantId, id: { in: itemIds } },
      select: { id: true, sku: true, name: true },
    });
    const catalogById = new Map(catalogItems.map((item) => [item.id, item]));
    // Historical valuation uses ledger cost snapshots, not today's catalog cost.
    const dates = enumerateDates(from, to);
    const balances = new Map<string, InventoryBalance>();
    let transactionIndex = 0;
    let issuedCost = new Prisma.Decimal(0);
    const issuesByItem = new Map<string, Date>();
    for (const transaction of transactions) {
      if (
        transaction.type === TransactionType.WORKSHOP_CONSUMPTION &&
        transaction.quantity.lt(0)
      ) {
        if (
          transaction.createdAt >= rangeStart &&
          transaction.createdAt < rangeEnd
        ) {
          if (transaction.cost_basis) {
            issuedCost = issuedCost.plus(
              transaction.quantity.abs().mul(transaction.cost_basis),
            );
          }
        }
        const latestIssue = issuesByItem.get(transaction.item_id);
        if (!latestIssue || transaction.createdAt > latestIssue) {
          issuesByItem.set(transaction.item_id, transaction.createdAt);
        }
      }
    }

    const dailyValues: Prisma.Decimal[] = [];
    let closingUnvaluedItemCount = 0;
    let hasUnvaluedDailyStock = false;
    for (const date of dates) {
      const nextDay = this.nextDate(date);
      const dayEnd = localDateStartUtc(nextDay, timeZone);
      while (
        transactionIndex < transactions.length &&
        transactions[transactionIndex].createdAt < dayEnd
      ) {
        const transaction = transactions[transactionIndex];
        const key = `${transaction.item_id}:${transaction.location_id}`;
        const balance = balances.get(key) ?? {
          quantity: new Prisma.Decimal(0),
          stockValue: new Prisma.Decimal(0),
          unvaluedQuantity: new Prisma.Decimal(0),
        };
        balance.quantity = balance.quantity.plus(transaction.quantity);
        if (transaction.cost_basis === null) {
          balance.unvaluedQuantity = balance.unvaluedQuantity.plus(
            transaction.quantity,
          );
        } else {
          balance.stockValue = balance.stockValue.plus(
            transaction.quantity.mul(transaction.cost_basis),
          );
        }
        balances.set(key, balance);
        transactionIndex += 1;
      }

      let dailyValue = new Prisma.Decimal(0);
      const unvaluedItems = new Set<string>();
      for (const [balanceKey, balance] of balances) {
        if (balance.quantity.lte(0)) continue;
        const itemId = balanceKey.slice(0, balanceKey.indexOf(':'));
        if (balance.unvaluedQuantity.gt(0)) {
          unvaluedItems.add(itemId);
        }
        dailyValue = dailyValue.plus(balance.stockValue);
      }
      dailyValues.push(dailyValue);
      if (unvaluedItems.size > 0) hasUnvaluedDailyStock = true;
      if (date === to) closingUnvaluedItemCount = unvaluedItems.size;
    }

    const averageStockValue = hasUnvaluedDailyStock
      ? null
      : averageDailyStockValue(dailyValues);
    const stockByItem = new Map<
      string,
      {
        quantity: Prisma.Decimal;
        stockValue: Prisma.Decimal;
        unvalued: boolean;
      }
    >();
    for (const [balanceKey, balance] of balances) {
      if (balance.quantity.lte(0)) continue;
      const itemId = balanceKey.slice(0, balanceKey.indexOf(':'));
      const value = stockByItem.get(itemId) ?? {
        quantity: new Prisma.Decimal(0),
        stockValue: new Prisma.Decimal(0),
        unvalued: false,
      };
      value.quantity = value.quantity.plus(balance.quantity);
      value.unvalued ||= balance.unvaluedQuantity.gt(0);
      value.stockValue = value.stockValue.plus(balance.stockValue);
      stockByItem.set(itemId, value);
    }
    const cutoffDate = dateOnly(to);
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - DEFAULT_SLOW_MOVER_DAYS);
    const cutoff = localDateStartUtc(toIsoDate(cutoffDate), timeZone);
    const slowMovers = [...stockByItem.entries()]
      .filter(([itemId]) => {
        const lastIssue = issuesByItem.get(itemId);
        return !lastIssue || lastIssue < cutoff;
      })
      .map(([catalogItemId, stock]) => {
        const catalogItem = catalogById.get(catalogItemId);
        if (!catalogItem) return null;
        const lastIssue = issuesByItem.get(catalogItemId);
        const age = lastIssue
          ? Math.floor(
              (dateOnly(to).getTime() -
                dateOnly(localDateForInstant(lastIssue, timeZone)).getTime()) /
                86_400_000,
            )
          : null;
        return {
          catalog_item_id: catalogItemId,
          sku: catalogItem.sku,
          name: catalogItem.name,
          quantity_on_hand: stock.quantity.toFixed(3),
          stock_value: stock.unvalued ? null : stock.stockValue.toFixed(2),
          days_since_last_issue: age,
          sort_value: stock.unvalued
            ? new Prisma.Decimal(-1)
            : stock.stockValue,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((left, right) => right.sort_value.comparedTo(left.sort_value))
      .slice(0, SLOW_MOVER_LIMIT)
      .map((row) => ({
        catalog_item_id: row.catalog_item_id,
        sku: row.sku,
        name: row.name,
        quantity_on_hand: row.quantity_on_hand,
        stock_value: row.stock_value,
        days_since_last_issue: row.days_since_last_issue,
      }));

    return {
      issued_cost: issuedCost.toFixed(2),
      average_stock_value: averageStockValue?.toFixed(2) ?? null,
      turnover: averageStockValue
        ? (calculatePartsTurnover(issuedCost, averageStockValue)?.toFixed(2) ??
          null)
        : null,
      unvalued_stock_item_count: closingUnvaluedItemCount,
      slow_movers: slowMovers,
    };
  }

  private nextDate(isoDate: string): string {
    const date = dateOnly(isoDate);
    date.setUTCDate(date.getUTCDate() + 1);
    return toIsoDate(date);
  }
}
