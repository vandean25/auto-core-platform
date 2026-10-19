import { NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertActiveMemberWithSiteAccess,
  assertSiteReadAccess,
  assertTenantAdmin,
} from './site.authorization.js';

export class SiteDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Names-only active directory (default): any user with an active TenantMember
   * AND at least one active SiteMembership may list active sites.
   * `includeInactive=true` is OWNER/ADMIN and returns full rows (active and
   * inactive) without requiring a SiteMembership (ruling 53).
   */
  async listSites(includeInactive = false) {
    const tenantId = await this.tenantContext.getTenantId();

    if (includeInactive) {
      assertTenantAdmin(this.tenantContext);
      return this.prisma.site.findMany({
        where: { tenant_id: tenantId },
        orderBy: [{ code: 'asc' }],
        include: {
          legal_entity: {
            select: { id: true, name: true, country_iso: true },
          },
          openingHours: { orderBy: { weekday: 'asc' } },
          _count: {
            select: { memberships: true, bays: true, storageLocations: true },
          },
        },
      });
    }

    await assertActiveMemberWithSiteAccess(
      this.prisma,
      this.tenantContext,
      tenantId,
    );
    const rows = await this.prisma.site.findMany({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: [{ code: 'asc' }],
      include: {
        legal_entity: { select: { id: true, name: true } },
      },
    });

    return rows.map((site) => ({
      id: site.id,
      code: site.code,
      name: site.name,
      legalEntityId: site.legal_entity_id,
      legalEntityName: site.legal_entity?.name,
    }));
  }

  /** getSite requires an active SiteMembership on that site OR OWNER/ADMIN. */
  async getSite(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    await assertSiteReadAccess(this.prisma, this.tenantContext, tenantId, id);
    const site = await this.prisma.site.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        legal_entity: true,
        openingHours: { orderBy: { weekday: 'asc' } },
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        storageLocations: { where: { deletedAt: null } },
      },
    });
    if (!site) {
      throw new NotFoundException('Site not found');
    }
    return site;
  }
}
