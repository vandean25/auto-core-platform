import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PdfStorage } from '../../common/pdf/pdf-storage.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import { countPdfPages } from './weekly-report-format.util.js';
import { WeeklyReportDataService } from './weekly-report-data.service.js';
import { WeeklyReportPdfRenderer } from './weekly-report-pdf.renderer.js';
import { resolveWeeklyReportPeriod } from './weekly-report-period.util.js';
import { WeeklyReportRateLimitService } from './weekly-report-rate-limit.service.js';

export type GenerateWeeklyReportPdfInput = {
  iso_week?: string;
  from?: string;
  to?: string;
  site_id?: string;
};

export type GenerateWeeklyReportPdfResult = {
  id: string;
  url: string;
  expires_at: string;
  sha256: string;
  page_count: number;
  period: {
    from: string;
    to: string;
    timezone: string;
    iso_week: string | null;
  };
};

const EPHEMERAL_KEY_PREFIX = 'ephemeral/weekly-reports';

@Injectable()
export class WeeklyReportPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly data: WeeklyReportDataService,
    private readonly renderer: WeeklyReportPdfRenderer,
    private readonly storage: PdfStorage,
    private readonly rateLimit: WeeklyReportRateLimitService,
  ) {}

  async generate(
    input: GenerateWeeklyReportPdfInput,
  ): Promise<GenerateWeeklyReportPdfResult> {
    this.assertReportRole();
    const tenantId = await this.tenantContext.getTenantId();
    await this.rateLimit.assertAllowed(tenantId);

    const { siteId, timezone } = await this.resolveSite(tenantId, input.site_id);
    const period = resolveWeeklyReportPeriod({
      iso_week: input.iso_week,
      from: input.from,
      to: input.to,
      timeZone: timezone,
    });

    const reportData = await this.data.load({
      siteId,
      timeZone: timezone,
      period,
    });

    const pdfBuffer = await this.renderer.render(reportData);
    const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
    const page_count = countPdfPages(pdfBuffer);
    const objectId = randomUUID();
    const key = `${EPHEMERAL_KEY_PREFIX}/${tenantId}/${objectId}.pdf`;

    await this.storage.uploadPdf({
      key,
      body: pdfBuffer,
      contentType: 'application/pdf',
    });

    const filename = `Wochenbericht-${period.from}_${period.to}.pdf`;
    const link = await this.storage.createSignedReadUrl({
      key,
      filename,
      ttlSeconds: 15 * 60,
    });

    return {
      id: objectId,
      url: link.url,
      expires_at: link.expiresAt.toISOString(),
      sha256,
      page_count,
      period: {
        from: period.from,
        to: period.to,
        timezone,
        iso_week: period.iso_week,
      },
    };
  }

  private assertReportRole(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role?.toUpperCase();
    if (!role || !['OWNER', 'ADMIN', 'SALES'].includes(role)) {
      throw new ForbiddenException(
        'Weekly report PDFs are not available for this role',
      );
    }
  }

  private async resolveSite(tenantId: string, siteId?: string) {
    const resolvedSiteId = siteId ?? (await this.siteContext.getSiteId());
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    if (!authorizedSiteIds.includes(resolvedSiteId)) {
      throw new NotFoundException('Weekly report site not found');
    }
    const site = await this.prisma.site.findFirst({
      where: { id: resolvedSiteId, tenant_id: tenantId, is_active: true },
      select: { id: true, timezone: true, legal_entity_id: true },
    });
    if (!site) {
      throw new NotFoundException('Weekly report site not found');
    }
    return { siteId: site.id, timezone: site.timezone };
  }
}
