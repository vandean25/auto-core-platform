import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolveEstimateScope } from './workshop-estimate-scope.js';
import {
  listSiteEstimateVersionsPage,
  type ListSiteEstimateVersionsFilters,
} from './workshop-estimate-version-site-list.read.js';
import { WorkshopSettingsService } from './workshop-settings.service.js';

@Injectable()
export class WorkshopEstimateSiteVersionListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly workshopSettings: WorkshopSettingsService,
  ) {}

  async listPage(
    filters: Omit<ListSiteEstimateVersionsFilters, 'timeZone'> & {
      pageSize: number;
      cursor?: string;
    },
  ) {
    const scope = await resolveEstimateScope({
      prisma: this.prisma,
      tenantContext: this.tenantContext,
      siteContext: this.siteContext,
    });
    const settings = await this.workshopSettings.getSettingsForSite(
      scope.tenantId,
      scope.siteId,
    );
    return listSiteEstimateVersionsPage(this.prisma, scope, {
      ...filters,
      timeZone: settings.timezone,
    });
  }
}
