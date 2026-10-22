import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, WorkshopEstimateStatus, WorkshopOrderStatus } from '@prisma/client';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { McpWorkshopOrderReadService } from './mcp-workshop-order-read.service.js';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const SITE_A = '00000000-0000-4000-8000-0000000000a1';
const SITE_B = '00000000-0000-4000-8000-0000000000b1';
const ORDER_SENT_TODAY = '00000000-0000-4000-8000-0000000000d1';
const ORDER_APPROVED = '00000000-0000-4000-8000-0000000000d2';
const ORDER_OTHER_SITE = '00000000-0000-4000-8000-0000000000d3';
const ESTIMATE_SENT = '00000000-0000-4000-8000-0000000000e1';
const ESTIMATE_APPROVED = '00000000-0000-4000-8000-0000000000e2';

const SENT_TODAY = new Date('2026-10-16T09:30:00.000Z');
/** Keeps the SENT fixture decidable; expiry uses the real clock in the service. */
const VALID_UNTIL_FAR_FUTURE = new Date(
  Date.now() + 30 * 24 * 60 * 60 * 1000,
);

function workshopOrderRow(id: string, siteId: string) {
  return {
    id,
    tenant_id: TENANT_A,
    site_id: siteId,
    order_number: `WO-${id.slice(-4)}`,
    status: WorkshopOrderStatus.IN_PROGRESS,
    scheduled_start_at: null,
    customer: null,
    vehicle: { id: 'v1', make: 'Demo', model: 'Car', plate: 'W-DEMO-1' },
    tasks: [],
  };
}

function buildService(options: {
  tenantId?: string;
  siteId?: string;
  timezone?: string | null;
  siteMissing?: boolean;
}) {
  const orders = [
    workshopOrderRow(ORDER_SENT_TODAY, SITE_A),
    workshopOrderRow(ORDER_APPROVED, SITE_A),
    workshopOrderRow(ORDER_OTHER_SITE, SITE_B),
  ];

  const grouped = [
    { estimate_id: ESTIMATE_SENT, _max: { version: 1 } },
    { estimate_id: ESTIMATE_APPROVED, _max: { version: 1 } },
  ];

  const versions = [
    {
      id: 'ver-sent',
      version: 1,
      status: WorkshopEstimateStatus.SENT,
      sent_at: SENT_TODAY,
      valid_until: VALID_UNTIL_FAR_FUTURE,
      total_gross: new Prisma.Decimal('240.00'),
      estimate: {
        estimate_number: 'KV-2026-0001',
        workshop_order_id: ORDER_SENT_TODAY,
      },
    },
    {
      id: 'ver-approved',
      version: 1,
      status: WorkshopEstimateStatus.APPROVED,
      sent_at: SENT_TODAY,
      valid_until: null,
      total_gross: new Prisma.Decimal('180.00'),
      estimate: {
        estimate_number: 'KV-2026-0002',
        workshop_order_id: ORDER_APPROVED,
      },
    },
  ];

  const prisma = {
    site: {
      findFirst: jest.fn().mockResolvedValue(
        options.siteMissing
          ? null
          : {
              timezone:
                options.timezone === undefined
                  ? 'Europe/Vienna'
                  : options.timezone,
            },
      ),
    },
    workshopOrder: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        orders.filter((row) => {
          if (where.tenant_id && row.tenant_id !== where.tenant_id) {
            return false;
          }
          if (where.site_id && row.site_id !== where.site_id) {
            return false;
          }
          const idFilter = where.id as { in?: string[] } | undefined;
          if (idFilter?.in && !idFilter.in.includes(row.id)) {
            return false;
          }
          return true;
        }),
      ),
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }): Promise<number> => {
        const rows = await prisma.workshopOrder.findMany({ where });
        return rows.length;
      }),
    },
    workshopEstimateVersion: {
      groupBy: jest.fn().mockResolvedValue(grouped),
      findMany: jest.fn().mockResolvedValue(versions),
    },
  };

  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(options.tenantId ?? TENANT_A),
  };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue(options.siteId ?? SITE_A),
  };

  const service = new McpWorkshopOrderReadService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    siteContext as unknown as SiteContextService,
  );

  return { service, prisma, tenantContext, siteContext };
}

describe('McpWorkshopOrderReadService', () => {
  it('returns only orders whose current estimate was sent today and is still SENT', async () => {
    const { service } = buildService({});
    const page = await service.listWorkshopOrders({
      estimate_status: 'SENT',
      sent_from: '2026-10-16',
      sent_to: '2026-10-16',
    });

    expect(page.data).toHaveLength(1);
    expect(page.data[0].id).toBe(ORDER_SENT_TODAY);
    expect(page.data[0].estimate).toMatchObject({
      number: 'KV-2026-0001',
      version: 1,
      status: 'SENT',
      total_gross: '240.00',
    });
    expect(page.meta).toEqual({
      total: 1,
      page: 1,
      pageSize: 10,
      pageCount: 1,
    });
  });

  it('scopes orders to the active tenant and site from the session', async () => {
    const { service, prisma } = buildService({ siteId: SITE_B, tenantId: TENANT_B });
    prisma.workshopOrder.findMany.mockResolvedValueOnce([]);
    prisma.workshopOrder.count.mockResolvedValueOnce(0);
    prisma.workshopEstimateVersion.groupBy.mockResolvedValueOnce([]);

    const page = await service.listWorkshopOrders({});

    expect(prisma.workshopOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT_B,
          site_id: SITE_B,
        }),
      }),
    );
    expect(page.data).toEqual([]);
  });

  it('rejects a missing active site', async () => {
    const { service } = buildService({ siteMissing: true });
    await expect(service.listWorkshopOrders({})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects date filters when the site has no timezone', async () => {
    const { service } = buildService({ timezone: null });
    await expect(
      service.listWorkshopOrders({
        sent_from: '2026-10-16',
        sent_to: '2026-10-16',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
