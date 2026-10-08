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
