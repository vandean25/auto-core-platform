import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WorkshopKpiReportsService } from './workshop-kpi-reports.service.js';

const fullWorkWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  is_working: weekday <= 5,
  start_time: weekday <= 5 ? '08:00' : null,
  end_time: weekday <= 5 ? '16:00' : null,
  break_minutes: 0,
}));

function serviceForEmployeeSchedules(
  employees: Array<{ id: string; name: string; is_active: boolean }>,
  schedules: Array<{
    employee_id: string;
    site_id: string | null;
    effective_from: Date;
    days: typeof fullWorkWeek;
  }>,
) {
  const prisma = {
    site: {
      findFirst: jest.fn().mockResolvedValue({ id: 'site-1', timezone: 'UTC' }),
    },
    employee: {
      findMany: jest
        .fn()
        .mockImplementation((args: { where?: { is_active?: boolean } }) =>
          Promise.resolve(
            employees.filter(
              (employee) =>
                args.where?.is_active === undefined ||
                employee.is_active === args.where.is_active,
            ),
          ),
        ),
    },
    employeeWorkSchedule: {
      findMany: jest.fn().mockResolvedValue(schedules),
    },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    workshopHoliday: { findMany: jest.fn().mockResolvedValue([]) },
    laborEntry: { findMany: jest.fn().mockResolvedValue([]) },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    inventoryTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    catalogItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new WorkshopKpiReportsService(
    prisma as never,
    {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN' }),
    } as never,
    { listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']) } as never,
  );
  return { prisma, service };
}

describe('WorkshopKpiReportsService', () => {
  it('rejects report ranges longer than 366 calendar days', async () => {
    const { service } = serviceForEmployeeSchedules([], []);

    await expect(
      service.getReport({
        siteId: 'site-1',
        from: '2025-01-01',
        to: '2026-01-02',
        groupBy: 'mechanic',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a report range of exactly 366 calendar days', async () => {
    const { service } = serviceForEmployeeSchedules([], []);

    const report = await service.getReport({
      siteId: 'site-1',
      from: '2025-01-01',
      to: '2026-01-01',
      groupBy: 'mechanic',
    });

    expect(report.data).toEqual([]);
  });

  it('rejects a requested site outside the caller authorized sites', async () => {
    const prisma = { site: { findFirst: jest.fn() } };
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN' }),
    };
    const siteContext = { listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']) };
    const service = new WorkshopKpiReportsService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
    );

    await expect(
      service.getReport({
        siteId: 'site-2',
        from: '2026-01-01',
        to: '2026-01-31',
        groupBy: 'mechanic',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.site.findFirst).not.toHaveBeenCalled();
  });

  it('builds mechanic KPIs from assigned schedules, booked leave, holidays and finalized invoices', async () => {
    const scheduleDays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      is_working: true,
      start_time: '08:00',
      end_time: '16:00',
      break_minutes: 0,
    }));
    const prisma = {
      site: { findFirst: jest.fn().mockResolvedValue({ id: 'site-1', timezone: 'UTC' }) },
      employee: { findMany: jest.fn().mockResolvedValue([{ id: 'employee-1', name: 'Alex Mechanic' }]) },
      employeeWorkSchedule: {
        findMany: jest.fn().mockResolvedValue([{
          employee_id: 'employee-1',
          site_id: 'site-1',
          effective_from: new Date('2026-01-01T00:00:00.000Z'),
          days: scheduleDays,
        }]),
      },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([{
        employee_id: 'employee-1',
        start_on: new Date('2026-01-01T00:00:00.000Z'),
        end_on: new Date('2026-01-01T00:00:00.000Z'),
        minutes_charged: 480,
      }]) },
      workshopHoliday: { findMany: jest.fn().mockResolvedValue([{
        observed_on: new Date('2026-01-02T00:00:00.000Z'),
        repeats_annually: false,
        is_closed: true,
      }]) },
      laborEntry: { findMany: jest.fn()
        .mockResolvedValueOnce([{
          employee_id: 'employee-1',
          started_at: new Date('2026-01-03T01:00:00.000Z'),
          ended_at: new Date('2026-01-03T07:00:00.000Z'),
        }])
        .mockResolvedValueOnce([{
          employee_id: 'employee-1',
          started_at: new Date('2026-01-03T08:00:00.000Z'),
        }]) },
      invoice: { findMany: jest.fn().mockResolvedValue([
        {
          id: 'invoice-1',
          date: new Date('2026-01-03T10:00:00.000Z'),
          total_net: new Prisma.Decimal('110.00'),
          workshop_order: {
            id: 'order-1',
            mechanic_id: 'employee-1',
            tasks: [{
              mechanic_id: null,
              line_items: [
                { type: 'LABOR', catalog_item_id: null, description: 'Service', quantity: new Prisma.Decimal('5.00') },
                { type: 'PART', catalog_item_id: 'part-1', description: 'Oil filter', quantity: new Prisma.Decimal('1.00') },
              ],
            }],
          },
          items: [
            { catalog_item_id: null, description: 'Service', quantity: new Prisma.Decimal('3.00'), unit_price: new Prisma.Decimal('20.00'), line_total: new Prisma.Decimal('60.00'), revenue_group_name: 'Workshop services' },
            { catalog_item_id: 'part-1', description: 'Oil filter', quantity: new Prisma.Decimal('1.00'), unit_price: new Prisma.Decimal('50.00'), line_total: new Prisma.Decimal('50.00'), revenue_group_name: null },
          ],
        },
        {
          id: 'invoice-2',
          date: new Date('2026-01-04T10:00:00.000Z'),
          total_net: new Prisma.Decimal('20.00'),
          workshop_order: { id: 'order-2', mechanic_id: null, tasks: [] },
          items: [
            { catalog_item_id: null, description: 'Unassigned labor', quantity: new Prisma.Decimal('1.00'), unit_price: new Prisma.Decimal('20.00'), line_total: new Prisma.Decimal('20.00'), revenue_group_name: 'Labor' },
          ],
        },
      ]) },
      inventoryTransaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            item_id: 'part-1',
            location_id: 'location-1',
            quantity: new Prisma.Decimal('1.000'),
            type: 'PURCHASE_RECEIPT',
            cost_basis: new Prisma.Decimal('10.00'),
            createdAt: new Date('2026-01-01T08:00:00.000Z'),
            seq: 1n,
          },
          {
            item_id: 'part-1',
            location_id: 'location-1',
            quantity: new Prisma.Decimal('1.000'),
            type: 'PURCHASE_RECEIPT',
            cost_basis: new Prisma.Decimal('20.00'),
            createdAt: new Date('2026-01-01T09:00:00.000Z'),
            seq: 2n,
          },
        ]),
      },
      catalogItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'part-1', sku: 'PART-1', name: 'Mixed cost part' },
        ]),
      },
    };
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN' }),
    };
    const siteContext = { listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']) };
    const service = new WorkshopKpiReportsService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
    );

    const report = await service.getReport({
      siteId: 'site-1',
      from: '2026-01-01',
      to: '2026-01-03',
      groupBy: 'mechanic',
    });

    expect(report.data[0]).toMatchObject({
      available_hours: '8.00',
      clocked_hours: '6.00',
      sold_hours: '3.00',
      labor_net_revenue: '60.00',
      parts_net_revenue: '50.00',
      utilisation_percent: '75.00',
      productivity_percent: '50.00',
      closed_orders: 1,
      average_net_revenue_per_order: '110.00',
      open_labor_entry_count: 1,
    });
    expect(report.parts_turnover).toMatchObject({
      issued_cost: '0.00',
      average_stock_value: '30.00',
      turnover: '0.00',
      slow_movers: [
        {
          catalog_item_id: 'part-1',
          sku: 'PART-1',
          name: 'Mixed cost part',
          quantity_on_hand: '2.000',
          stock_value: '30.00',
          days_since_last_issue: null,
        },
      ],
    });
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workshop_order: {
            is: { tenant_id: 'tenant-1', site_id: 'site-1' },
          },
        }),
      }),
    );
    expect(report.totals).toMatchObject({
      sold_hours: '4.00',
      productivity_percent: '66.67',
    });
  });

  it('forbids TECH before reading the requested site', async () => {
    const prisma = { site: { findFirst: jest.fn() } };
    const service = new WorkshopKpiReportsService(
      prisma as never,
      {
        getTenantId: jest.fn().mockResolvedValue('tenant-1'),
        getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'TECH' }),
      } as never,
      { listAuthorizedSiteIds: jest.fn() } as never,
    );

    await expect(service.getReport({
      siteId: 'site-1', from: '2026-01-01', to: '2026-01-31', groupBy: 'mechanic',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.site.findFirst).not.toHaveBeenCalled();
  });

  it('includes inactive mechanics with historical schedules at the selected site', async () => {
    const { service } = serviceForEmployeeSchedules(
      [{ id: 'former-mechanic', name: 'Former mechanic', is_active: false }],
      [{
        employee_id: 'former-mechanic',
        site_id: 'site-1',
        effective_from: new Date('2026-01-01T00:00:00.000Z'),
        days: fullWorkWeek,
      }],
    );

    const report = await service.getReport({
      siteId: 'site-1',
      from: '2026-01-05',
      to: '2026-01-05',
      groupBy: 'mechanic',
    });

    expect(report.data).toHaveLength(1);
    expect(report.data[0]).toMatchObject({
      mechanic_name: 'Former mechanic',
      available_hours: '8.00',
    });
  });

  it('omits mechanics assigned only to another site', async () => {
    const { service } = serviceForEmployeeSchedules(
      [{ id: 'other-site-mechanic', name: 'Other site mechanic', is_active: true }],
      [{
        employee_id: 'other-site-mechanic',
        site_id: 'site-2',
        effective_from: new Date('2026-01-01T00:00:00.000Z'),
        days: fullWorkWeek,
      }],
    );

    const report = await service.getReport({
      siteId: 'site-1',
      from: '2026-01-05',
      to: '2026-01-05',
      groupBy: 'mechanic',
    });

    expect(report.data).toEqual([]);
  });
});

type ReportFixture = {
  role?: string | null;
  site?: { id: string; timezone: string } | null;
  employees?: Array<{ id: string; name: string }>;
  schedules?: Array<{
    employee_id: string;
    site_id: string | null;
    effective_from: Date;
    days: Array<(typeof fullWorkWeek)[number]>;
  }>;
  leaveRequests?: unknown[];
  holidays?: unknown[];
  closedEntries?: unknown[];
  openEntries?: unknown[];
  invoices?: unknown[];
};

function reportService(fixture: ReportFixture) {
  const prisma = {
    site: {
      findFirst: jest.fn().mockResolvedValue(
        fixture.site === undefined
          ? { id: 'site-1', timezone: 'UTC' }
          : fixture.site,
      ),
    },
    employee: { findMany: jest.fn().mockResolvedValue(fixture.employees ?? []) },
    employeeWorkSchedule: {
      findMany: jest.fn().mockResolvedValue(fixture.schedules ?? []),
    },
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue(fixture.leaveRequests ?? []),
    },
    workshopHoliday: {
      findMany: jest.fn().mockResolvedValue(fixture.holidays ?? []),
    },
    laborEntry: {
      findMany: jest
        .fn()
        .mockImplementation((args: { where: { ended_at: unknown } }) =>
          Promise.resolve(
            args.where.ended_at === null
              ? (fixture.openEntries ?? [])
              : (fixture.closedEntries ?? []),
          ),
        ),
    },
    invoice: { findMany: jest.fn().mockResolvedValue(fixture.invoices ?? []) },
    inventoryTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    catalogItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new WorkshopKpiReportsService(
    prisma as never,
    {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      getAuthenticatedUser: jest
        .fn()
        .mockReturnValue(
          fixture.role === null ? undefined : { role: fixture.role ?? 'ADMIN' },
        ),
    } as never,
    { listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']) } as never,
  );
  return { prisma, service };
}

function line(
  type: 'LABOR' | 'PART',
  description: string,
  quantity: string,
  catalogItemId: string | null = null,
) {
  return {
    type,
    catalog_item_id: catalogItemId,
    description,
    quantity: new Prisma.Decimal(quantity),
  };
}

function invoiceItem(
  description: string,
  quantity: string,
  unitPrice: string,
  lineTotal: string | null,
  revenueGroupName: string | null = null,
  catalogItemId: string | null = null,
) {
  return {
    catalog_item_id: catalogItemId,
    description,
    quantity: new Prisma.Decimal(quantity),
    unit_price: new Prisma.Decimal(unitPrice),
    line_total: lineTotal === null ? null : new Prisma.Decimal(lineTotal),
    revenue_group_name: revenueGroupName,
  };
}

const emptyPartsTurnover = {
  issued_cost: '0.00',
  average_stock_value: '0.00',
  turnover: null,
  unvalued_stock_item_count: 0,
  slow_movers: [],
};

// Characterization tests (AUT-671): pin getReport's current behavior.
describe('WorkshopKpiReportsService.getReport characterization', () => {
  const siteSchedule = (employeeId: string, siteId: string | null = 'site-1') => ({
    employee_id: employeeId,
    site_id: siteId,
    effective_from: new Date('2026-01-01T00:00:00.000Z'),
    days: fullWorkWeek,
  });

  it('forbids a request without an authenticated role', async () => {
    const { prisma, service } = reportService({ role: null });

    await expect(
      service.getReport({ siteId: 'site-1', from: '2026-01-01', to: '2026-01-01', groupBy: 'mechanic' }),
    ).rejects.toThrow(new ForbiddenException('Workshop KPI reports are not available for this role'));
    expect(prisma.site.findFirst).not.toHaveBeenCalled();
  });

  it.each(['owner', 'Sales'])('accepts the %s role case-insensitively', async (role) => {
    const { service } = reportService({ role });

    const report = await service.getReport({
      siteId: 'site-1', from: '2026-01-01', to: '2026-01-01', groupBy: 'mechanic',
    });

    expect(report.data).toEqual([]);
  });

  it('rejects a range whose start is after its end', async () => {
    const { prisma, service } = reportService({});

    await expect(
      service.getReport({ siteId: 'site-1', from: '2026-01-02', to: '2026-01-01', groupBy: 'week' }),
    ).rejects.toThrow(new BadRequestException('from must be on or before to'));
    expect(prisma.site.findFirst).not.toHaveBeenCalled();
  });

  it('reports the range limit in the error message', async () => {
    const { service } = reportService({});

    await expect(
      service.getReport({ siteId: 'site-1', from: '2025-01-01', to: '2026-01-02', groupBy: 'month' }),
    ).rejects.toThrow(
      new BadRequestException('Workshop KPI report range cannot exceed 366 calendar days'),
    );
  });

  it('rejects an authorized site that is missing or inactive', async () => {
    const { prisma, service } = reportService({ site: null });

    await expect(
      service.getReport({ siteId: 'site-1', from: '2026-01-01', to: '2026-01-01', groupBy: 'mechanic' }),
    ).rejects.toThrow(new NotFoundException('Workshop KPI report site not found'));
    expect(prisma.site.findFirst).toHaveBeenCalledWith({
      where: { id: 'site-1', tenant_id: 'tenant-1', is_active: true },
      select: { id: true, timezone: true },
    });
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('rejects a schedule at the site that has no row for the weekday', async () => {
    const { prisma, service } = reportService({
      employees: [{ id: 'm1', name: 'Gap Mechanic' }],
      schedules: [{ ...siteSchedule('m1'), days: fullWorkWeek.filter((day) => day.weekday !== 1) }],
    });

    await expect(
      service.getReport({ siteId: 'site-1', from: '2026-01-05', to: '2026-01-05', groupBy: 'mechanic' }),
    ).rejects.toThrow(
      new BadRequestException('Work schedule for Gap Mechanic is missing weekday data'),
    );
    expect(prisma.inventoryTransaction.findMany).not.toHaveBeenCalled();
  });

  it('builds weekly KPIs in the site timezone and reads exactly the scoped data', async () => {
    const { prisma, service } = reportService({
      site: { id: 'site-1', timezone: 'Europe/Vienna' },
      employees: [
        { id: 'm1', name: 'Mechanic One' },
        { id: 'm2', name: 'No schedule' },
        { id: 'm3', name: 'Null site' },
      ],
      schedules: [siteSchedule('m1'), siteSchedule('m3', null)],
      leaveRequests: [{
        employee_id: 'm1',
        start_on: new Date('2026-01-30T00:00:00.000Z'),
        end_on: new Date('2026-01-30T00:00:00.000Z'),
        minutes_charged: 240,
      }],
      holidays: [{
        observed_on: new Date('2019-02-02T00:00:00.000Z'),
        repeats_annually: true,
        is_closed: true,
      }],
      closedEntries: [
        // Starts before the Vienna range start (2026-01-28T23:00Z): clipped to 30 minutes.
        { employee_id: 'm1', started_at: new Date('2026-01-28T22:00:00.000Z'), ended_at: new Date('2026-01-28T23:30:00.000Z') },
        // Crosses Vienna midnight into Monday 2026-02-02: 3 hours in W05, 2 hours in W06.
        { employee_id: 'm1', started_at: new Date('2026-02-01T20:00:00.000Z'), ended_at: new Date('2026-02-02T01:00:00.000Z') },
        { employee_id: 'ghost', started_at: new Date('2026-01-30T08:00:00.000Z'), ended_at: new Date('2026-01-30T09:00:00.000Z') },
        { employee_id: 'm1', started_at: new Date('2026-01-30T08:00:00.000Z'), ended_at: null },
      ],
      openEntries: [
        { employee_id: 'm1', started_at: new Date('2026-02-02T23:30:00.000Z') },
        { employee_id: 'ghost', started_at: new Date('2026-01-30T08:00:00.000Z') },
      ],
      invoices: [
        {
          id: 'invoice-1',
          date: new Date('2026-01-31T10:00:00.000Z'),
          total_net: new Prisma.Decimal('130.00'),
          workshop_order: {
            id: 'order-1',
            mechanic_id: 'm1',
            tasks: [{ mechanic_id: null, line_items: [line('LABOR', 'Diagnosis', '2.00'), line('PART', 'Filter', '1.00', 'part-1')] }],
          },
          items: [
            invoiceItem('Diagnosis', '2.00', '50.00', null),
            invoiceItem('Filter', '1.00', '30.00', '30.00', null, 'part-1'),
          ],
        },
        {
          // Vienna local date is Monday 2026-02-02, so the invoice lands in W06.
          id: 'invoice-2',
          date: new Date('2026-02-01T23:30:00.000Z'),
          total_net: new Prisma.Decimal('40.00'),
          workshop_order: { id: 'order-1', mechanic_id: 'm1', tasks: [] },
          items: [invoiceItem('Flat rate', '0.50', '80.00', '40.00', 'LABOR flat rate')],
        },
      ],
    });

    const report = await service.getReport({
      siteId: 'site-1', from: '2026-01-29', to: '2026-02-03', groupBy: 'week',
    });

    expect(report).toEqual({
      data: [
        {
          key: '2026-W05', period: '2026-W05', mechanic_id: null, mechanic_name: null,
          available_hours: '12.00', clocked_hours: '3.50', sold_hours: '2.00',
          labor_net_revenue: '100.00', parts_net_revenue: '30.00',
          utilisation_percent: '29.17', productivity_percent: '57.14',
          closed_orders: 1, average_net_revenue_per_order: '130.00', open_labor_entry_count: 0,
        },
        {
          key: '2026-W06', period: '2026-W06', mechanic_id: null, mechanic_name: null,
          available_hours: '8.00', clocked_hours: '2.00', sold_hours: '0.50',
          labor_net_revenue: '40.00', parts_net_revenue: '0.00',
          utilisation_percent: '25.00', productivity_percent: '25.00',
          closed_orders: 1, average_net_revenue_per_order: '40.00', open_labor_entry_count: 1,
        },
      ],
      meta: {
        from: '2026-01-29', to: '2026-02-03', timezone: 'Europe/Vienna', groupBy: 'week',
        unassigned_mechanic_count: 2,
      },
      totals: {
        key: 'total', period: '2026-01-29–2026-02-03', mechanic_id: null, mechanic_name: null,
        available_hours: '20.00', clocked_hours: '5.50', sold_hours: '2.50',
        labor_net_revenue: '140.00', parts_net_revenue: '30.00',
        utilisation_percent: '27.50', productivity_percent: '45.45',
        closed_orders: 1, average_net_revenue_per_order: '170.00', open_labor_entry_count: 1,
      },
      parts_turnover: emptyPartsTurnover,
    });

    const rangeStart = new Date('2026-01-28T23:00:00.000Z');
    const rangeEnd = new Date('2026-02-03T23:00:00.000Z');
    const scopedTask = {
      tenant_id: 'tenant-1',
      workshop_order: { tenant_id: 'tenant-1', site_id: 'site-1' },
    };
    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', role: 'MECHANIC' },
      select: { id: true, name: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
    expect(prisma.employeeWorkSchedule.findMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1' },
      include: { days: { where: { tenant_id: 'tenant-1' } } },
      orderBy: [{ employee_id: 'asc' }, { effective_from: 'asc' }],
    });
    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        status: 'BOOKED',
        start_on: { lte: new Date('2026-02-03T00:00:00.000Z') },
        end_on: { gte: new Date('2026-01-29T00:00:00.000Z') },
      },
      select: { employee_id: true, start_on: true, end_on: true, minutes_charged: true },
    });
    expect(prisma.workshopHoliday.findMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', site_id: 'site-1' },
      select: { observed_on: true, repeats_annually: true, is_closed: true },
    });
    expect(prisma.laborEntry.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        tenant_id: 'tenant-1',
        started_at: { lt: rangeEnd },
        ended_at: { not: null, gt: rangeStart },
        workshop_task: scopedTask,
      },
      select: { employee_id: true, started_at: true, ended_at: true },
    });
    expect(prisma.laborEntry.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        tenant_id: 'tenant-1',
        ended_at: null,
        started_at: { gte: rangeStart, lt: rangeEnd },
        workshop_task: scopedTask,
      },
      select: { employee_id: true, started_at: true },
    });
    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        status: { in: ['FINALIZED', 'ISSUED', 'PAID'] },
        date: { gte: rangeStart, lt: rangeEnd },
        workshop_order_id: { not: null },
        workshop_order: { is: { tenant_id: 'tenant-1', site_id: 'site-1' } },
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
              where: { tenant_id: 'tenant-1' },
              select: {
                mechanic_id: true,
                line_items: {
                  where: { tenant_id: 'tenant-1' },
                  select: { type: true, catalog_item_id: true, description: true, quantity: true },
                },
              },
            },
          },
        },
        items: {
          where: { tenant_id: 'tenant-1' },
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
    });
    expect(prisma.inventoryTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-1', site_id: 'site-1', createdAt: { lt: rangeEnd } },
      }),
    );
  });

  it('builds monthly KPIs and splits clocked time at the month boundary', async () => {
    const { service } = reportService({
      employees: [{ id: 'm1', name: 'Mechanic One' }],
      schedules: [siteSchedule('m1')],
      closedEntries: [
        { employee_id: 'm1', started_at: new Date('2026-01-31T22:00:00.000Z'), ended_at: new Date('2026-02-01T02:00:00.000Z') },
      ],
      invoices: [{
        id: 'invoice-1',
        date: new Date('2026-02-01T09:00:00.000Z'),
        total_net: new Prisma.Decimal('25.00'),
        workshop_order: { id: 'order-1', mechanic_id: null, tasks: [] },
        items: [invoiceItem('Bulb', '1.00', '25.00', '25.00')],
      }],
    });

    const report = await service.getReport({
      siteId: 'site-1', from: '2026-01-30', to: '2026-02-02', groupBy: 'month',
    });

    expect(report.data).toEqual([
      expect.objectContaining({
        period: '2026-01', available_hours: '8.00', clocked_hours: '2.00',
        sold_hours: '0.00', parts_net_revenue: '0.00', closed_orders: 0,
      }),
      expect.objectContaining({
        period: '2026-02', available_hours: '8.00', clocked_hours: '2.00',
        sold_hours: '0.00', parts_net_revenue: '25.00', closed_orders: 1,
        average_net_revenue_per_order: '25.00',
      }),
    ]);
    expect(report.totals).toMatchObject({
      available_hours: '16.00', clocked_hours: '4.00', parts_net_revenue: '25.00', closed_orders: 1,
    });
  });

  it('splits invoices across mechanics by labor hours and classifies invoice lines', async () => {
    const { service } = reportService({
      employees: [
        { id: 'm1', name: 'Mechanic One' },
        { id: 'm2', name: 'Mechanic Two' },
        { id: 'm3', name: 'Other site' },
        { id: 'm4', name: 'Clock only' },
        { id: 'm5', name: 'Idle' },
      ],
      schedules: [siteSchedule('m1'), siteSchedule('m2'), siteSchedule('m3', 'site-2')],
      closedEntries: [
        { employee_id: 'm1', started_at: new Date('2026-03-02T08:00:00.000Z'), ended_at: new Date('2026-03-02T12:00:00.000Z') },
        // Clipped to one hour inside the range; puts the other-site mechanic on the report.
        { employee_id: 'm3', started_at: new Date('2026-03-01T22:00:00.000Z'), ended_at: new Date('2026-03-02T01:00:00.000Z') },
        // Entirely before the range: no hours, but the mechanic is still listed.
        { employee_id: 'm4', started_at: new Date('2026-03-01T20:00:00.000Z'), ended_at: new Date('2026-03-01T21:00:00.000Z') },
      ],
      openEntries: [{ employee_id: 'm2', started_at: new Date('2026-03-02T09:00:00.000Z') }],
      invoices: [
        {
          id: 'invoice-1',
          date: new Date('2026-03-02T15:00:00.000Z'),
          total_net: new Prisma.Decimal('320.00'),
          workshop_order: {
            id: 'order-1',
            mechanic_id: 'm1',
            tasks: [
              { mechanic_id: null, line_items: [line('LABOR', 'Brake job', '3.00'), line('PART', 'Pads', '2.00', 'part-1'), line('PART', 'Mixed', '7.00', 'part-2')] },
              { mechanic_id: 'm2', line_items: [line('LABOR', 'Brake job', '1.00'), line('LABOR', 'Mixed', '8.00', 'part-2')] },
              { mechanic_id: 'outsider', line_items: [line('LABOR', 'Wash', '5.00')] },
            ],
          },
          items: [
            // No exact quantity match: typed by source key (LABOR).
            invoiceItem('Brake job', '4.00', '50.00', '200.00'),
            invoiceItem('Pads', '2.00', '30.00', '60.00', null, 'part-1'),
            // Conflicting source types and no revenue group: falls back to PART.
            invoiceItem('Mixed', '1.00', '10.00', '10.00', null, 'part-2'),
            // Typed from a task of a non-employee mechanic: still LABOR.
            invoiceItem('Wash', '5.00', '10.00', '50.00'),
          ],
        },
        {
          id: 'invoice-2',
          date: new Date('2026-03-02T16:00:00.000Z'),
          total_net: new Prisma.Decimal('20.00'),
          workshop_order: {
            id: 'order-2',
            mechanic_id: null,
            tasks: [
              { mechanic_id: 'm1', line_items: [line('PART', 'Clip', '1.00', 'part-3')] },
              { mechanic_id: 'm2', line_items: [line('PART', 'Clip', '2.00', 'part-3')] },
            ],
          },
          // No labor hours on the order: revenue is shared equally, sold hours are not.
          items: [invoiceItem('Labor fee', '1.00', '20.00', '20.00', 'Labor')],
        },
        {
          // Unreachable through the query filter; pinned because it still counts in the totals average.
          id: 'invoice-3',
          date: new Date('2026-03-02T17:00:00.000Z'),
          total_net: new Prisma.Decimal('5.00'),
          workshop_order: null,
          items: [],
        },
      ],
    });

    const report = await service.getReport({
      siteId: 'site-1', from: '2026-03-02', to: '2026-03-02', groupBy: 'mechanic',
    });

    expect(report).toEqual({
      data: [
        {
          key: 'm1', period: '2026-03-02–2026-03-02', mechanic_id: 'm1', mechanic_name: 'Mechanic One',
          available_hours: '8.00', clocked_hours: '4.00', sold_hours: '2.25',
          labor_net_revenue: '72.50', parts_net_revenue: '17.50',
          utilisation_percent: '50.00', productivity_percent: '56.25',
          closed_orders: 2, average_net_revenue_per_order: '45.00', open_labor_entry_count: 0,
        },
        {
          key: 'm2', period: '2026-03-02–2026-03-02', mechanic_id: 'm2', mechanic_name: 'Mechanic Two',
          available_hours: '8.00', clocked_hours: '0.00', sold_hours: '6.75',
          labor_net_revenue: '197.50', parts_net_revenue: '52.50',
          utilisation_percent: '0.00', productivity_percent: null,
          closed_orders: 2, average_net_revenue_per_order: '125.00', open_labor_entry_count: 1,
        },
        {
          key: 'm3', period: '2026-03-02–2026-03-02', mechanic_id: 'm3', mechanic_name: 'Other site',
          available_hours: '0.00', clocked_hours: '1.00', sold_hours: '0.00',
          labor_net_revenue: '0.00', parts_net_revenue: '0.00',
          utilisation_percent: null, productivity_percent: '0.00',
          closed_orders: 0, average_net_revenue_per_order: null, open_labor_entry_count: 0,
        },
        {
          key: 'm4', period: '2026-03-02–2026-03-02', mechanic_id: 'm4', mechanic_name: 'Clock only',
          available_hours: '0.00', clocked_hours: '0.00', sold_hours: '0.00',
          labor_net_revenue: '0.00', parts_net_revenue: '0.00',
          utilisation_percent: null, productivity_percent: null,
          closed_orders: 0, average_net_revenue_per_order: null, open_labor_entry_count: 0,
        },
      ],
      meta: {
        from: '2026-03-02', to: '2026-03-02', timezone: 'UTC', groupBy: 'mechanic',
        unassigned_mechanic_count: 2,
      },
      totals: {
        key: 'total', period: '2026-03-02–2026-03-02', mechanic_id: null, mechanic_name: null,
        available_hours: '16.00', clocked_hours: '5.00', sold_hours: '10.00',
        labor_net_revenue: '270.00', parts_net_revenue: '70.00',
        utilisation_percent: '31.25', productivity_percent: '200.00',
        closed_orders: 2, average_net_revenue_per_order: '172.50', open_labor_entry_count: 1,
      },
      parts_turnover: emptyPartsTurnover,
    });
  });

  it('lists mechanics reached only by a task or an open entry and types lines by exact quantity first', async () => {
    const { service } = reportService({
      employees: [
        { id: 'm1', name: 'Mechanic One' },
        { id: 't1', name: 'Task only' },
        { id: 'o1', name: 'Open only' },
      ],
      schedules: [siteSchedule('m1')],
      openEntries: [{ employee_id: 'o1', started_at: new Date('2026-03-02T09:00:00.000Z') }],
      invoices: [{
        id: 'invoice-1',
        date: new Date('2026-03-02T15:00:00.000Z'),
        total_net: new Prisma.Decimal('40.00'),
        workshop_order: {
          id: 'order-1',
          mechanic_id: 'm1',
          tasks: [
            { mechanic_id: null, line_items: [line('LABOR', 'Mixed', '2.00', 'part-1')] },
            // Zero labor hours: the mechanic is listed with a zero share.
            { mechanic_id: 't1', line_items: [line('PART', 'Mixed', '3.00', 'part-1')] },
          ],
        },
        // Conflicting source types; the exact quantity match makes it LABOR.
        items: [invoiceItem('Mixed', '2.00', '20.00', '40.00', null, 'part-1')],
      }],
    });

    const report = await service.getReport({
      siteId: 'site-1', from: '2026-03-02', to: '2026-03-02', groupBy: 'mechanic',
    });

    expect(report.data).toEqual([
      {
        key: 'm1', period: '2026-03-02–2026-03-02', mechanic_id: 'm1', mechanic_name: 'Mechanic One',
        available_hours: '8.00', clocked_hours: '0.00', sold_hours: '2.00',
        labor_net_revenue: '40.00', parts_net_revenue: '0.00',
        utilisation_percent: '0.00', productivity_percent: null,
        closed_orders: 1, average_net_revenue_per_order: '40.00', open_labor_entry_count: 0,
      },
      {
        key: 't1', period: '2026-03-02–2026-03-02', mechanic_id: 't1', mechanic_name: 'Task only',
        available_hours: '0.00', clocked_hours: '0.00', sold_hours: '0.00',
        labor_net_revenue: '0.00', parts_net_revenue: '0.00',
        utilisation_percent: null, productivity_percent: null,
        closed_orders: 1, average_net_revenue_per_order: '0.00', open_labor_entry_count: 0,
      },
      {
        key: 'o1', period: '2026-03-02–2026-03-02', mechanic_id: 'o1', mechanic_name: 'Open only',
        available_hours: '0.00', clocked_hours: '0.00', sold_hours: '0.00',
        labor_net_revenue: '0.00', parts_net_revenue: '0.00',
        utilisation_percent: null, productivity_percent: null,
        closed_orders: 0, average_net_revenue_per_order: null, open_labor_entry_count: 1,
      },
    ]);
    expect(report.meta.unassigned_mechanic_count).toBe(2);
  });
});
