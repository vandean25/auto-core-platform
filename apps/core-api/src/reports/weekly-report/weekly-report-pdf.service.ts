import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PdfStorage } from '../../common/pdf/pdf-storage.js';
import { weeklyReportObjectExpiresAt } from '../../common/pdf/weekly-report-pdf-bucket.js';
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

export type WeeklyReportPdfPeriod = {
  from: string;
  to: string;
  timezone: string;
  iso_week: string | null;
};

export type WeeklyReportPdfPreview = {
  period: WeeklyReportPdfPeriod;
  site_id: string;
};

export type GenerateWeeklyReportPdfResult = {
  id: string;
  site_id: string;
  url: string;
  expires_at: string;
  sha256: string;
  page_count: number;
  period: WeeklyReportPdfPeriod;
  storage_bucket: string;
  storage_key: string;
  object_expires_at: string;
};

const READ_LINK_TTL_SECONDS = 15 * 60;

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

  /** Side-effect free validation for MCP dry-run preview (no render, upload, or rate limit). */
  async preview(
    input: GenerateWeeklyReportPdfInput,
  ): Promise<WeeklyReportPdfPreview> {
    this.assertReportRole();
    const tenantId = await this.tenantContext.getTenantId();
    const { siteId, timezone } = await this.resolveSite(
      tenantId,
      input.site_id,
    );
    const period = resolveWeeklyReportPeriod({
      iso_week: input.iso_week,
      from: input.from,
      to: input.to,
      timeZone: timezone,
    });
    return {
      site_id: siteId,
      period: {
        from: period.from,
        to: period.to,
        timezone,
        iso_week: period.iso_week,
      },
    };
  }

  async execute(
    input: GenerateWeeklyReportPdfInput,
  ): Promise<GenerateWeeklyReportPdfResult> {
    this.assertReportRole();
    const tenantId = await this.tenantContext.getTenantId();
    await this.rateLimit.assertAllowed(tenantId);

    const preview = await this.preview(input);
    await this.storage.deleteExpiredEphemeralWeeklyReports({ tenantId });

    const reportData = await this.data.load({
      siteId: preview.site_id,
      timeZone: preview.period.timezone,
      period: {
        from: preview.period.from,
        to: preview.period.to,
        iso_week: preview.period.iso_week,
      },
    });

    const pdfBuffer = await this.renderer.render(reportData);
    const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
    const page_count = countPdfPages(pdfBuffer);
    const objectId = randomUUID();
    const uploadedAt = new Date();
    const objectExpiresAt = weeklyReportObjectExpiresAt(uploadedAt);

    const { bucket, key } = await this.storage.uploadEphemeralWeeklyReportPdf({
      tenantId,
      objectId,
      body: pdfBuffer,
      objectExpiresAt,
      sha256,
    });

    const filename = `Wochenbericht-${preview.period.from}_${preview.period.to}.pdf`;
    const link = await this.storage.createSignedReadUrl({
      bucket,
      key,
      filename,
      ttlSeconds: READ_LINK_TTL_SECONDS,
    });

    return {
      id: objectId,
      site_id: preview.site_id,
      url: link.url,
      expires_at: link.expiresAt.toISOString(),
      sha256,
      page_count,
      period: preview.period,
      storage_bucket: bucket,
      storage_key: key,
      object_expires_at: objectExpiresAt.toISOString(),
    };
  }

  /** Re-sign a stored artifact for command_id replay (never return an expired bearer URL). */
  async refreshSignedUrl(
    stored: Pick<
      GenerateWeeklyReportPdfResult,
      | 'id'
      | 'sha256'
      | 'page_count'
      | 'period'
      | 'storage_bucket'
      | 'storage_key'
      | 'object_expires_at'
    >,
  ): Promise<GenerateWeeklyReportPdfResult> {
    const objectExpiresAt = new Date(stored.object_expires_at);
    if (objectExpiresAt.getTime() <= Date.now()) {
      return this.regenerateFromStoredMetadata(stored);
    }

    const filename = `Wochenbericht-${stored.period.from}_${stored.period.to}.pdf`;
    try {
      const link = await this.storage.createSignedReadUrl({
        bucket: stored.storage_bucket,
        key: stored.storage_key,
        filename,
        ttlSeconds: READ_LINK_TTL_SECONDS,
      });
      return {
        ...stored,
        url: link.url,
        expires_at: link.expiresAt.toISOString(),
      };
    } catch {
      return this.regenerateFromStoredMetadata(stored);
    }
  }

  private async regenerateFromStoredMetadata(
    stored: Pick<
      GenerateWeeklyReportPdfResult,
      'id' | 'period' | 'storage_bucket' | 'storage_key'
    >,
  ): Promise<GenerateWeeklyReportPdfResult> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.rateLimit.assertAllowed(tenantId);
    const siteId =
      'site_id' in stored && typeof stored.site_id === 'string'
        ? stored.site_id
        : undefined;
    const input: GenerateWeeklyReportPdfInput = stored.period.iso_week
      ? { iso_week: stored.period.iso_week, site_id: siteId }
      : {
          from: stored.period.from,
          to: stored.period.to,
          site_id: siteId,
        };
    return this.execute(input);
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
