import { AuditLogAction, WorkshopOrderStatus } from '@prisma/client';
import { WeeklyReportDataService } from './weekly-report-data.service.js';

describe('WeeklyReportDataService completed orders', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  const timeZone = 'Europe/Vienna';
  const period = { from: '2026-10-12', to: '2026-10-18', iso_week: '2026-W42' };

  const finance = { getRevenueReport: jest.fn() };
  const workshopKpis = { getReport: jest.fn() };
  const tenantContext = { getTenantId: jest.fn().mockResolvedValue(tenantId) };

  let auditFindMany: jest.Mock;
  let workshopOrderFindMany: jest.Mock;
  let completionOrdersResponse: Array<{
    id: string;
    order_number: string;
    vehicle: { make: string; model: string; plate: string };
  }>;
  let service: WeeklyReportDataService;

  beforeEach(() => {
    auditFindMany = jest.fn();
    completionOrdersResponse = [];
    workshopOrderFindMany = jest.fn().mockImplementation((args: { where?: { status?: string } }) => {
      if (args?.where?.status === WorkshopOrderStatus.COMPLETED) {
        return Promise.resolve(completionOrdersResponse);
      }
      return Promise.resolve([]);
    });
    const prisma = {
      site: {
        findFirst: jest.fn().mockResolvedValue({
          id: siteId,
          name: 'Site',
          timezone: timeZone,
        }),
      },
      workshopOrder: { findMany: workshopOrderFindMany },
      auditLog: { findMany: auditFindMany },
    };
    finance.getRevenueReport.mockResolvedValue({
      totals: {},
      by_source: [],
      by_revenue_group: [],
      invoice_count: 0,
    });
    workshopKpis.getReport.mockResolvedValue({
      totals: {},
      parts_turnover: { turnover: '1' },
    });
    service = new WeeklyReportDataService(
      prisma as never,
      tenantContext as never,
      finance as never,
      workshopKpis as never,
    );
  });

  it('does not list an order completed last week when only edited this week', async () => {
    const orderId = 'order-edited';
    auditFindMany.mockResolvedValueOnce([
      {
        entity_id: orderId,
        occurred_at: new Date('2026-10-14T10:00:00.000Z'),
        diff: { notes: { before: 'old', after: 'new' } },
      },
    ]);
    workshopOrderFindMany.mockResolvedValue([]);

    const data = await service.load({ siteId, timeZone, period });
    expect(data.completed_orders).toEqual([]);
    const completedOrderQueries = workshopOrderFindMany.mock.calls.filter(
      (call) => call[0]?.where?.status === WorkshopOrderStatus.COMPLETED,
    );
    expect(completedOrderQueries).toHaveLength(0);
  });

  it('paginates audit logs so a completion is not dropped after many other updates', async () => {
    const orderId = 'order-completed';
    auditFindMany.mockImplementation(({ skip }: { skip?: number }) => {
      if (skip === 0) {
        return Promise.resolve(
          Array.from({ length: 500 }, (_, index) => ({
            entity_id: `noise-${index}`,
            occurred_at: new Date('2026-10-13T12:00:00.000Z'),
            diff: { notes: { before: 'a', after: 'b' } },
          })),
        );
      }
      if (skip === 500) {
        return Promise.resolve([
          {
            entity_id: orderId,
            occurred_at: new Date('2026-10-13T14:00:00.000Z'),
            diff: {
              status: {
                before: WorkshopOrderStatus.IN_PROGRESS,
                after: WorkshopOrderStatus.COMPLETED,
              },
            },
          },
        ]);
      }
      return Promise.resolve([]);
    });
    completionOrdersResponse = [
      {
        id: orderId,
        order_number: 'WO-1',
        vehicle: { make: 'VW', model: 'Golf', plate: 'W-123' },
      },
    ];

    const data = await service.load({ siteId, timeZone, period });
    expect(data.completed_orders).toHaveLength(1);
    expect(data.completed_orders[0].order_number).toBe('WO-1');
    expect(auditFindMany).toHaveBeenCalledTimes(2);
    expect(auditFindMany.mock.calls[0][0]).toMatchObject({
      where: {
        tenant_id: tenantId,
        entity_type: 'WorkshopOrder',
        action: AuditLogAction.UPDATE,
      },
      skip: 0,
    });
  });
});
