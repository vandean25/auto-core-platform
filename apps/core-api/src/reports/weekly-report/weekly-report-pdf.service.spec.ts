import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WeeklyReportPdfService } from './weekly-report-pdf.service.js';

describe('WeeklyReportPdfService', () => {
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN' }),
  };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue('site-1'),
    listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
  };
  const prisma = {
    site: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'site-1',
        timezone: 'Europe/Vienna',
      }),
    },
  };
  const data = {
    load: jest.fn().mockResolvedValue({
      period: {
        from: '2026-10-12',
        to: '2026-10-18',
        iso_week: '2026-W42',
        timezone: 'Europe/Vienna',
      },
      site: {
        id: 'site-1',
        name: 'Nord Werkstatt',
        timezone: 'Europe/Vienna',
      },
      revenue: {
        totals: {
          net: new Prisma.Decimal('100'),
          vat: new Prisma.Decimal('20'),
          gross: new Prisma.Decimal('120'),
        },
        by_source: [],
        by_revenue_group: [],
        invoice_count: 1,
      },
      workshop_kpis: {
        totals: {
          utilisation_percent: '50.00',
          productivity_percent: '60.00',
          average_net_revenue_per_order: '100.00',
          closed_orders: 1,
        },
        parts_turnover: { turnover: '1.20' },
      },
      open_estimates: [],
      completed_orders: [],
    }),
  };
  const renderer = {
    render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4\n1 0 obj\n/Type /Page\n')),
  };
  const storage = {
    uploadPdf: jest.fn().mockResolvedValue({ bucket: 'b', key: 'k', etag: null }),
    createSignedReadUrl: jest.fn().mockResolvedValue({
      url: 'https://storage.example/report.pdf',
      expiresAt: new Date('2026-10-17T13:00:00.000Z'),
    }),
  };
  const rateLimit = { assertAllowed: jest.fn().mockResolvedValue(undefined) };

  let service: WeeklyReportPdfService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WeeklyReportPdfService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
      data as never,
      renderer as never,
      storage as never,
      rateLimit as never,
    );
  });

  it('generates, uploads, and returns a signed link without logging the URL in summaries', async () => {
    const result = await service.generate({ iso_week: '2026-W42' });
    expect(rateLimit.assertAllowed).toHaveBeenCalledWith('tenant-1');
    expect(storage.uploadPdf).toHaveBeenCalled();
    expect(result.url).toContain('https://');
    expect(result.page_count).toBeGreaterThan(0);
    expect(result.period.iso_week).toBe('2026-W42');
  });

  it('rejects callers without report roles', async () => {
    tenantContext.getAuthenticatedUser.mockReturnValueOnce({ role: 'MECHANIC' });
    await expect(service.generate({ iso_week: '2026-W42' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('treats unauthorized site_id as not found', async () => {
    siteContext.listAuthorizedSiteIds.mockResolvedValueOnce(['other-site']);
    await expect(
      service.generate({ iso_week: '2026-W42', site_id: 'site-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
