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

type ReportData = Awaited<
  ReturnType<WorkshopKpiReportsService['loadReportData']>
>;
type ReportInvoice = ReportData['invoices'][number];
type ReportOrder = NonNullable<ReportInvoice['workshop_order']>;

type ReportBuckets = {
  query: WorkshopKpiReportQueryDto;
  timezone: string;
  mechanics: Map<string, MetricAccumulator>;
  periods: Map<string, MetricAccumulator>;
  reportMechanicIds: Set<string>;
};

type InvoiceAmounts = {
  soldHours: Prisma.Decimal;
  laborRevenue: Prisma.Decimal;
  partsRevenue: Prisma.Decimal;
};

type InvoiceTotals = InvoiceAmounts & { orderIds: Set<string> };

type LineTypeIndex = {
  byLine: Map<string, WorkshopLineItemType>;
  bySource: Map<string, WorkshopLineItemType | null>;
};

function rangeLabel(query: WorkshopKpiReportQueryDto): string {
  return `${query.from}–${query.to}`;
}

function periodForDate(
  query: WorkshopKpiReportQueryDto,
  isoDate: string,
): string {
  return query.groupBy === 'mechanic'
    ? rangeLabel(query)
    : reportPeriodKey(isoDate, query.groupBy);
}

function periodForInstant(buckets: ReportBuckets, instant: Date): string {
  const { query } = buckets;
  return query.groupBy === 'mechanic'
    ? rangeLabel(query)
    : reportPeriodKey(
        localDateForInstant(instant, buckets.timezone),
        query.groupBy,
      );
}

function createBuckets(
  query: WorkshopKpiReportQueryDto,
  timezone: string,
  employees: ReportData['employees'],
  dates: string[],
): ReportBuckets {
  const periodKeys = [
    ...new Set(dates.map((date) => periodForDate(query, date))),
  ];
  return {
    query,
    timezone,
    mechanics: new Map(
      employees.map((employee) => [
        employee.id,
        createAccumulator(
          employee.id,
          rangeLabel(query),
          employee.id,
          employee.name,
        ),
      ]),
    ),
    periods: new Map(
      periodKeys.map((period) => [
        period,
        createAccumulator(period, period, null, null),
      ]),
    ),
    reportMechanicIds: new Set<string>(),
  };
}

function bucketFor(
  buckets: ReportBuckets,
  employeeId: string,
  period: string,
): MetricAccumulator | undefined {
  return buckets.query.groupBy === 'mechanic'
    ? buckets.mechanics.get(employeeId)
    : buckets.periods.get(period);
}

function availableMinutesOnDate(
  employeeName: string,
  schedule: ScheduleRecord,
  date: string,
  leaveMinutes: number | undefined,
  holidays: ReportData['holidays'],
): number {
  const scheduleDay = schedule.days.find(
    (day) => day.weekday === weekdayForDate(date),
  );
  if (!scheduleDay) {
    throw new BadRequestException(
      `Work schedule for ${employeeName} is missing weekday data`,
    );
  }
  const available = calculateAvailableHours([
    {
      scheduledMinutes: expectedMinutesForScheduleDay(scheduleDay),
      approvedLeaveMinutes: Math.round(leaveMinutes ?? 0),
      workshopClosed: isHolidayClosed(date, holidays),
    },
  ]);
  return Number(available.mul(60).toFixed(0));
}

/** Adds scheduled availability at the site; returns mechanics without a site on some day. */
function addAvailableMinutes(
  buckets: ReportBuckets,
  data: Pick<
    ReportData,
    'employees' | 'schedules' | 'leaveRequests' | 'holidays'
  >,
  dates: string[],
): Set<string> {
  const siteId = buckets.query.siteId;
  const leaveAllocations = leaveMinutesByEmployeeDate(
    data.leaveRequests,
    data.schedules,
  );
  const employeesMissingSite = new Set<string>();
  for (const employee of data.employees) {
    for (const date of dates) {
      const schedule = resolveSchedule(data.schedules, employee.id, date);
      if (!schedule || !schedule.site_id) {
        employeesMissingSite.add(employee.id);
        continue;
      }
      if (schedule.site_id !== siteId) continue;
      buckets.reportMechanicIds.add(employee.id);
      const minutes = availableMinutesOnDate(
        employee.name,
        schedule,
        date,
        leaveAllocations.get(`${employee.id}:${siteId}:${date}`),
        data.holidays,
      );
      const accumulator = bucketFor(
        buckets,
        employee.id,
        periodForDate(buckets.query, date),
      );
      if (accumulator) accumulator.availableMinutes += minutes;
    }
  }
  return employeesMissingSite;
}

function clockedSplits(
  buckets: ReportBuckets,
  start: Date,
  end: Date,
): Array<{ period: string; hours: Prisma.Decimal }> {
  const { query } = buckets;
  if (query.groupBy === 'mechanic') {
    const minutes = (end.getTime() - start.getTime()) / 60_000;
    return [
      {
        period: rangeLabel(query),
        hours: new Prisma.Decimal(minutes).dividedBy(60),
      },
    ];
  }
  return splitLaborIntervalByPeriod(
    start,
    end,
    buckets.timezone,
    query.groupBy,
  );
}

function addClockedHours(
  buckets: ReportBuckets,
  entries: ClosedLaborEntry[],
  rangeStart: Date,
  rangeEnd: Date,
): void {
  for (const entry of entries) {
    if (!buckets.mechanics.has(entry.employee_id) || !entry.ended_at) continue;
    buckets.reportMechanicIds.add(entry.employee_id);
    const clippedStart = new Date(
      Math.max(entry.started_at.getTime(), rangeStart.getTime()),
    );
    const clippedEnd = new Date(
      Math.min(entry.ended_at.getTime(), rangeEnd.getTime()),
    );
    if (clippedEnd <= clippedStart) continue;
    for (const split of clockedSplits(buckets, clippedStart, clippedEnd)) {
      const accumulator = bucketFor(buckets, entry.employee_id, split.period);
      if (accumulator) addHours(accumulator, split.hours);
    }
  }
}

function addOpenEntries(
  buckets: ReportBuckets,
  entries: ReportData['openEntries'],
): void {
  for (const entry of entries) {
    if (!buckets.mechanics.has(entry.employee_id)) continue;
    buckets.reportMechanicIds.add(entry.employee_id);
    const accumulator = bucketFor(
      buckets,
      entry.employee_id,
      periodForInstant(buckets, entry.started_at),
    );
    if (accumulator) accumulator.openEntries += 1;
  }
}

function indexLineTypes(tasks: ReportOrder['tasks']): LineTypeIndex {
  const index: LineTypeIndex = { byLine: new Map(), bySource: new Map() };
  for (const task of tasks) {
    for (const line of task.line_items) {
      const sourceKey = `${line.catalog_item_id ?? ''}|${line.description}`;
      index.byLine.set(`${sourceKey}|${line.quantity.toString()}`, line.type);
      if (!index.bySource.has(sourceKey)) {
        index.bySource.set(sourceKey, line.type);
      } else if (index.bySource.get(sourceKey) !== line.type) {
        // The same source booked as labor and part: let the revenue group decide.
        index.bySource.set(sourceKey, null);
      }
    }
  }
  return index;
}

function invoiceLineType(
  item: ReportInvoice['items'][number],
  index: LineTypeIndex,
): WorkshopLineItemType {
  const sourceKey = `${item.catalog_item_id ?? ''}|${item.description}`;
  return (
    index.byLine.get(`${sourceKey}|${item.quantity.toString()}`) ??
    index.bySource.get(sourceKey) ??
    (item.revenue_group_name?.toLowerCase().includes('labor')
      ? WorkshopLineItemType.LABOR
      : WorkshopLineItemType.PART)
  );
}

function invoiceAmounts(
  items: ReportInvoice['items'],
  tasks: ReportOrder['tasks'],
): InvoiceAmounts {
  const index = indexLineTypes(tasks);
  const amounts: InvoiceAmounts = {
    soldHours: new Prisma.Decimal(0),
    laborRevenue: new Prisma.Decimal(0),
    partsRevenue: new Prisma.Decimal(0),
  };
  for (const item of items) {
    const lineNet = item.line_total ?? item.quantity.mul(item.unit_price);
    if (invoiceLineType(item, index) === WorkshopLineItemType.LABOR) {
      amounts.laborRevenue = amounts.laborRevenue.plus(lineNet);
      amounts.soldHours = amounts.soldHours.plus(item.quantity);
    } else {
      amounts.partsRevenue = amounts.partsRevenue.plus(lineNet);
    }
  }
  return amounts;
}

function laborHoursByMechanic(
  buckets: ReportBuckets,
  order: ReportOrder,
): Map<string, Prisma.Decimal> {
  const laborByMechanic = new Map<string, Prisma.Decimal>();
  for (const task of order.tasks) {
    const assignedMechanic = task.mechanic_id ?? order.mechanic_id;
    if (!assignedMechanic || !buckets.mechanics.has(assignedMechanic)) continue;
    buckets.reportMechanicIds.add(assignedMechanic);
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
  return laborByMechanic;
}

function addInvoiceAmounts(
  target: MetricAccumulator,
  amounts: InvoiceAmounts,
  revenue: Prisma.Decimal,
): void {
  target.soldHours = target.soldHours.plus(amounts.soldHours);
  target.revenue = target.revenue.plus(revenue);
  target.laborRevenue = target.laborRevenue.plus(amounts.laborRevenue);
  target.partsRevenue = target.partsRevenue.plus(amounts.partsRevenue);
  target.closedOrders += 1;
}

/** Shares an invoice by labor hours; without labor hours revenue is split evenly and no hours are sold. */
function addInvoiceToMechanics(
  buckets: ReportBuckets,
  laborByMechanic: Map<string, Prisma.Decimal>,
  period: string,
  amounts: InvoiceAmounts,
  totalNet: Prisma.Decimal,
): void {
  const allocations = [...laborByMechanic.entries()];
  const assignedLaborHours = allocations.reduce(
    (total, [, hours]) => total.plus(hours),
    new Prisma.Decimal(0),
  );
  for (const [employeeId, laborHours] of allocations) {
    const accumulator = bucketFor(buckets, employeeId, period);
    if (!accumulator) continue;
    const mechanicShare = assignedLaborHours.isZero()
      ? new Prisma.Decimal(1).dividedBy(allocations.length)
      : laborHours.dividedBy(assignedLaborHours);
    addInvoiceAmounts(
      accumulator,
      {
        soldHours: amounts.soldHours.mul(
          assignedLaborHours.isZero() ? new Prisma.Decimal(0) : mechanicShare,
        ),
        laborRevenue: amounts.laborRevenue.mul(mechanicShare),
        partsRevenue: amounts.partsRevenue.mul(mechanicShare),
      },
      decimal(totalNet).mul(mechanicShare),
    );
  }
}

function addInvoices(
  buckets: ReportBuckets,
  invoices: ReportInvoice[],
): InvoiceTotals {
  const totals: InvoiceTotals = {
    orderIds: new Set<string>(),
    soldHours: new Prisma.Decimal(0),
    laborRevenue: new Prisma.Decimal(0),
    partsRevenue: new Prisma.Decimal(0),
  };
  for (const invoice of invoices) {
    const order = invoice.workshop_order;
    if (!order) continue;
    totals.orderIds.add(order.id);
    const period = periodForInstant(buckets, invoice.date);
    const laborByMechanic = laborHoursByMechanic(buckets, order);
    const amounts = invoiceAmounts(invoice.items, order.tasks);
    totals.soldHours = totals.soldHours.plus(amounts.soldHours);
    totals.laborRevenue = totals.laborRevenue.plus(amounts.laborRevenue);
    totals.partsRevenue = totals.partsRevenue.plus(amounts.partsRevenue);
    if (buckets.query.groupBy === 'mechanic') {
      addInvoiceToMechanics(
        buckets,
        laborByMechanic,
        period,
        amounts,
        invoice.total_net,
      );
    } else {
      const accumulator = buckets.periods.get(period);
      if (accumulator)
        addInvoiceAmounts(accumulator, amounts, invoice.total_net);
    }
  }
  return totals;
}

function reportEntries(buckets: ReportBuckets): MetricAccumulator[] {
  return buckets.query.groupBy === 'mechanic'
    ? [...buckets.mechanics.entries()]
        .filter(([employeeId]) => buckets.reportMechanicIds.has(employeeId))
        .map(([, accumulator]) => accumulator)
    : [...buckets.periods.values()];
}

/** Sums the rows, then takes sold hours, revenue and orders from all invoices (unassigned work included). */
function totalRow(
  query: WorkshopKpiReportQueryDto,
  entries: MetricAccumulator[],
  invoiceTotals: InvoiceTotals,
  invoices: ReportInvoice[],
): WorkshopKpiReportRowDto {
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
    createAccumulator('total', rangeLabel(query), null, null),
  );
  const orderCount = invoiceTotals.orderIds.size;
  const totalInvoiceRevenue = invoices.reduce(
    (total, invoice) => total.plus(invoice.total_net),
    new Prisma.Decimal(0),
  );
  return {
    ...rowFromAccumulator(totals),
    closed_orders: orderCount,
    sold_hours: invoiceTotals.soldHours.toFixed(2),
    productivity_percent:
      calculateProductivity(
        invoiceTotals.soldHours,
        totals.clockedHours,
      )?.toFixed(2) ?? null,
    labor_net_revenue: invoiceTotals.laborRevenue.toFixed(2),
    parts_net_revenue: invoiceTotals.partsRevenue.toFixed(2),
    average_net_revenue_per_order: orderCount
      ? totalInvoiceRevenue.dividedBy(orderCount).toFixed(2)
      : null,
  };
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
    const { tenantId, site } = await this.authorizeReportSite(query);
    const dates = enumerateDates(query.from, query.to);
    const rangeStart = localDateStartUtc(query.from, site.timezone);
    const rangeEnd = localDateStartUtc(this.nextDate(query.to), site.timezone);
    const data = await this.loadReportData(
      tenantId,
      query,
      rangeStart,
      rangeEnd,
    );

    const buckets = createBuckets(query, site.timezone, data.employees, dates);
    const employeesMissingSite = addAvailableMinutes(buckets, data, dates);
    addClockedHours(
      buckets,
      data.closedEntries as ClosedLaborEntry[],
      rangeStart,
      rangeEnd,
    );
    addOpenEntries(buckets, data.openEntries);
    const invoiceTotals = addInvoices(buckets, data.invoices);
    const entries = reportEntries(buckets);
    const partsTurnover = await this.getPartsTurnover(
      tenantId,
      query.siteId,
      query.from,
      query.to,
      site.timezone,
      rangeStart,
      rangeEnd,
    );

    return {
      data: entries.map(rowFromAccumulator),
      meta: {
        from: query.from,
        to: query.to,
        timezone: site.timezone,
        groupBy: query.groupBy,
        unassigned_mechanic_count: employeesMissingSite.size,
      },
      totals: totalRow(query, entries, invoiceTotals, data.invoices),
      parts_turnover: partsTurnover,
    };
  }

  private async authorizeReportSite(query: WorkshopKpiReportQueryDto) {
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
    return { tenantId, site };
  }

  private async loadReportData(
    tenantId: string,
    query: WorkshopKpiReportQueryDto,
    rangeStart: Date,
    rangeEnd: Date,
  ) {
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
    return {
      employees,
      schedules,
      leaveRequests,
      holidays,
      closedEntries,
      openEntries,
      invoices,
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
