import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSiteMembershipDto } from './dto/site.dto';
import { assertSiteInTenant, assertTenantAdmin } from './site.authorization';
import { validateSiteMembershipCreateInput } from './site.validator';

@Injectable()
export class SiteMembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly dashboardRealtime: DashboardRealtimeService,
  ) {}

  async listSiteMemberships(siteId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await assertSiteInTenant(this.prisma, tenantId, siteId);

    return this.prisma.siteMembership.findMany({
      where: { tenant_id: tenantId, site_id: siteId },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        tenantMember: { select: { role: true, is_active: true } },
      },
    });
  }

  async addSiteMembership(siteId: string, dto: CreateSiteMembershipDto) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await assertSiteInTenant(this.prisma, tenantId, siteId);

    // POST /api/sites/:id/memberships → 422 unless an active TenantMember
    // exists for that (tenant_id, user_id). The composite FK backs this up.
    const member = await this.prisma.tenantMember.findFirst({
      where: { tenant_id: tenantId, user_id: dto.userId },
      select: { id: true, is_active: true },
    });

    const existing = await this.prisma.siteMembership.findFirst({
      where: { tenant_id: tenantId, user_id: dto.userId, site_id: siteId },
      select: { id: true },
    });

    validateSiteMembershipCreateInput(member, existing);

    const membership = await this.prisma.siteMembership.create({
      data: {
        tenant_id: tenantId,
        user_id: dto.userId,
        site_id: siteId,
        is_active: true,
      },
    });
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId },
      select: { firebaseUid: true },
    });
    if (user) {
      this.dashboardRealtime.emitSiteAccessScopeUpdated(user.firebaseUid);
    }
    return membership;
  }

  async removeSiteMembership(siteId: string, userId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await assertSiteInTenant(this.prisma, tenantId, siteId);

    const membership = await this.prisma.siteMembership.findFirst({
      where: { tenant_id: tenantId, site_id: siteId, user_id: userId },
    });
    if (!membership) {
      throw new NotFoundException('Site membership not found');
    }

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.siteMembership.delete({ where: { id: membership.id } });
      // Ruling 10: removing a membership that matches User.active_site_id
      // clears active_site_id atomically (null).
      await tx.user.updateMany({
        where: { active_site_id: siteId, id: userId },
        data: { active_site_id: null },
      });
      return tx.user.findFirst({
        where: { id: userId },
        select: { firebaseUid: true, active_site_id: true },
      });
    });

    if (user) {
      this.dashboardRealtime.emitSiteAccessScopeUpdated(user.firebaseUid);
      if (user.active_site_id === null) {
        this.dashboardRealtime.emitSiteContextUpdated(user.firebaseUid, null);
      }
    }

    return { deleted: true };
  }
}
