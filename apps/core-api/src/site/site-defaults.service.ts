import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export class SiteDefaultsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveDefaultSiteId(tenantId: string): Promise<string> {
    const site = await this.prisma.site.findFirst({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException(
        'No active site exists for this tenant. Create or activate a site before creating site-scoped records.',
      );
    }
    return site.id;
  }

  async resolveDefaultSite(tenantId: string) {
    return this.prisma.site.findFirst({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: { code: 'asc' },
    });
  }
}
