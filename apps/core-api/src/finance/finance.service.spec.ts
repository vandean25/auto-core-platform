import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceTaxMode, Prisma } from '@prisma/client';
import { FinanceService } from './finance.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const SITE_ID = '00000000-0000-4000-8000-0000000000a1';
const TENANT_ID = '00000000-0000-4000-8000-0000000000b2';

function createService(options?: {
  role?: string;
  authorizedSites?: string[];
  timezone?: string;
}) {
  const prisma = {
    site: {
      findFirst: jest.fn().mockResolvedValue({
        id: SITE_ID,
        timezone: options?.timezone ?? 'Europe/Vienna',
      }),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    creditNote: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role: options?.role ?? 'ADMIN',
    }),
  } as unknown as TenantContextService;
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue(SITE_ID),
    listAuthorizedSiteIds: jest
      .fn()
      .mockResolvedValue(options?.authorizedSites ?? [SITE_ID]),
  } as unknown as SiteContextService;
  const service = new FinanceService(
    prisma as unknown as PrismaService,
    tenantContext,
    siteContext,
  );
  return { service, prisma, tenantContext, siteContext };
}

describe('FinanceService.getRevenueReport', () => {
  it('rejects callers outside OWNER, ADMIN, and SALES', async () => {
    const { service } = createService({ role: 'TECH' });
    await expect(
      service.getRevenueReport({ from: '2026-01-01', to: '2026-01-31' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects ranges longer than 366 days', async () => {
    const { service } = createService();
    await expect(
      service.getRevenueReport({ from: '2025-01-01', to: '2026-01-02' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unauthorized sites as not found', async () => {
    const { service } = createService({ authorizedSites: [] });
    await expect(
      service.getRevenueReport({
        from: '2026-01-01',
        to: '2026-01-31',
        site_id: SITE_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('loads invoices with site-local midnight bounds', async () => {
    const { service, prisma } = createService({ timezone: 'Europe/Vienna' });
    await service.getRevenueReport({
      from: '2026-03-01',
      to: '2026-03-02',
      site_id: SITE_ID,
    });

    const invoiceCall = prisma.invoice.findMany.mock.calls[0][0];
    expect(invoiceCall.where.site_id).toBe(SITE_ID);
    expect(invoiceCall.where.date.gte).toBeInstanceOf(Date);
    expect(invoiceCall.where.date.lt).toBeInstanceOf(Date);
    expect(
      invoiceCall.where.date.lt.getTime() - invoiceCall.where.date.gte.getTime(),
    ).toBeGreaterThan(0);
  });

  it('includes compare_previous when requested', async () => {
    const { service, prisma } = createService();
    prisma.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'inv-1',
        tax_mode: InvoiceTaxMode.STANDARD,
        workshop_order_id: 'wo-1',
        vehicle_sale_id: null,
        total_net: new Prisma.Decimal('10.00'),
        total_tax: new Prisma.Decimal('2.00'),
        total_gross: new Prisma.Decimal('12.00'),
        items: [
          {
            id: 'line-1',
            revenue_group_name: 'Parts',
            quantity: new Prisma.Decimal('1'),
            unit_price: new Prisma.Decimal('10.00'),
            line_total: new Prisma.Decimal('10.00'),
            tax_rate: new Prisma.Decimal('20'),
          },
        ],
      },
    ]);

    const report = await service.getRevenueReport({
      from: '2026-04-10',
      to: '2026-04-11',
      site_id: SITE_ID,
      compare_previous: true,
    });

    expect(prisma.invoice.findMany).toHaveBeenCalledTimes(2);
    expect(report.previous?.period).toEqual({
      from: '2026-04-08',
      to: '2026-04-09',
      timezone: 'Europe/Vienna',
    });
  });
});
