import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SetActiveSiteDto } from './dto/site.dto.js';
import { resolveSiteContextUser } from './site-session.user.js';

export class SiteSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly dashboardRealtime: DashboardRealtimeService,
  ) {}

  async listMySites() {
    const tenantId = await this.tenantContext.getTenantId();
    const user = await this.requireSiteContextUser(tenantId);

    const memberships = await this.prisma.siteMembership.findMany({
      where: {
        tenant_id: tenantId,
        user_id: user.id,
        is_active: true,
        site: { is_active: true },
        tenantMember: { is_active: true },
      },
      include: {
        site: {
          select: {
            id: true,
            code: true,
            name: true,
            legal_entity_id: true,
            legal_entity: { select: { name: true } },
          },
        },
      },
      orderBy: [{ site: { code: 'asc' } }],
    });

    return memberships.map((membership) => ({
      id: membership.site.id,
      code: membership.site.code,
      name: membership.site.name,
      legalEntityId: membership.site.legal_entity_id,
      legalEntityName: membership.site.legal_entity?.name,
    }));
  }

  async setActiveSite(dto: SetActiveSiteDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const user = await this.requireSiteContextUser(tenantId);

    if (dto.siteId === null) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { active_site_id: null },
      });
      this.dashboardRealtime.emitSiteContextUpdated(user.firebaseUid, null);
      return { activeSiteId: null };
    }

    const targetSiteId = dto.siteId;
    await this.prisma.$transaction(async (tx) => {
      const site = await tx.site.findFirst({
        where: { id: targetSiteId, tenant_id: tenantId, is_active: true },
        select: { id: true },
      });
      if (!site) {
        throw new UnprocessableEntityException(
          'The requested site is not active in this tenant.',
        );
      }

      const tenantMember = await tx.tenantMember.findFirst({
        where: { tenant_id: tenantId, user_id: user.id, is_active: true },
        select: { id: true },
      });
      if (!tenantMember) {
        throw new UnprocessableEntityException(
          'An active tenant membership is required.',
        );
      }

      const siteMembership = await tx.siteMembership.findFirst({
        where: {
          tenant_id: tenantId,
          user_id: user.id,
          site_id: targetSiteId,
          is_active: true,
        },
        select: { id: true },
      });
      if (!siteMembership) {
        throw new UnprocessableEntityException(
          'An active site membership on the requested site is required.',
        );
      }

      await tx.user.update({
        where: { id: user.id },
        data: { active_site_id: targetSiteId },
      });
    });

    this.dashboardRealtime.emitSiteContextUpdated(
      user.firebaseUid,
      targetSiteId,
    );
    return { activeSiteId: targetSiteId };
  }

  private async requireSiteContextUser(tenantId: string) {
    const authUser = this.tenantContext.getAuthenticatedUser();
    const user = await resolveSiteContextUser(
      this.prisma,
      tenantId,
      authUser?.userId,
    );
    if (!user) {
      throw new ForbiddenException('Active tenant membership is required.');
    }
    return user;
  }
}
