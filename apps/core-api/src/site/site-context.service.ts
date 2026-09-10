import {
  Inject,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
  forwardRef,
} from '@nestjs/common';
import type { Site } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves the authenticated session's active site (ADR-0022 / ruling 7).
 *
 * `User.active_site_id` is the session site. Every access is validated:
 *  - the caller has a tenant context (active tenant),
 *  - the site belongs to that tenant,
 *  - the site is `is_active`,
 *  - the caller has an active `TenantMember` in that tenant,
 *  - the caller has an active `SiteMembership` on that site.
 *
 * Operational APIs call `getSiteId()` — never `?siteId=` or `X-Site-Id`
 * (ruling 7). Missing or invalid context is **422 `ACTIVE_SITE_REQUIRED`**
 * (ruling 8); tenant-wide APIs, `GET /me/sites` and `PATCH /me/active-site`
 * stay usable for recovery.
 */
@Injectable()
export class SiteContextService {
  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Returns the validated active site id or throws 422 `ACTIVE_SITE_REQUIRED`.
   */
  async getSiteId(): Promise<string> {
    const site = await this.getSite();
    return site.id;
  }

  /**
   * Returns the validated active site or throws 422 `ACTIVE_SITE_REQUIRED`.
   */
  async getSite(): Promise<Site> {
    const site = await this.tryGetSite();
    if (!site) {
      throw this.activeSiteRequiredException();
    }
    return site;
  }

  /**
   * Returns the validated active site, or `null` when the caller has no valid
   * active site (recovery APIs, realtime room resolution).
   */
  async tryGetSite(): Promise<Site | null> {
    return this.resolveActiveSite();
  }

  /**
   * Returns the validated active site id or `null` when none is available.
   * Used by the realtime gateway to join the active site room on connect.
   */
  async resolveSiteId(): Promise<string | null> {
    const site = await this.tryGetSite();
    return site?.id ?? null;
  }

  /**
   * Resolves the caller's active site against the full ruling-7 validation.
   * Never throws; returns `null` when no active site is available.
   */
  private async resolveActiveSite(): Promise<Site | null> {
    const authUser = this.tenantContext.getAuthenticatedUser();
    if (!authUser?.userId) {
      return null;
    }
    const tenantId = this.tenantContext.getRequiredTenantId();

    const user = await this.prisma.user.findFirst({
      where: { firebaseUid: authUser.userId },
      select: { id: true, active_tenant_id: true, active_site_id: true },
    });
    if (!user?.active_site_id) {
      return null;
    }
    if (user.active_tenant_id !== tenantId) {
      return null;
    }

    const site = await this.prisma.site.findFirst({
      where: { id: user.active_site_id, is_active: true },
    });
    if (!site) {
      return null;
    }

    const tenantMember = await this.prisma.tenantMember.findFirst({
      where: {
        tenant_id: tenantId,
        user_id: user.id,
        is_active: true,
      },
      select: { id: true },
    });
    if (!tenantMember) {
      return null;
    }

    const siteMembership = await this.prisma.siteMembership.findFirst({
      where: {
        tenant_id: tenantId,
        user_id: user.id,
        site_id: site.id,
        is_active: true,
      },
      select: { id: true },
    });
    if (!siteMembership) {
      return null;
    }

    return site;
  }

  /**
   * Site ids the caller may operate on across sites: every site with an
   * **active** `SiteMembership` joined to an **active** `TenantMember` in the
   * current tenant (ruling 12). Never derived from a caller-provided list.
   */
  async listAuthorizedSiteIds(): Promise<string[]> {
    const authUser = this.tenantContext.getAuthenticatedUser();
    if (!authUser?.userId) {
      throw new InternalServerErrorException(
        'SiteContext requires an authenticated user.',
      );
    }
    const tenantId = this.tenantContext.getRequiredTenantId();

    const user = await this.prisma.user.findFirst({
      where: { firebaseUid: authUser.userId },
      select: { id: true },
    });
    if (!user) {
      return [];
    }

    const memberships = await this.prisma.siteMembership.findMany({
      where: {
        tenant_id: tenantId,
        user_id: user.id,
        is_active: true,
        site: { is_active: true },
        tenantMember: { is_active: true },
      },
      select: { site_id: true },
    });
    return [...new Set(memberships.map((membership) => membership.site_id))];
  }

  private activeSiteRequiredException(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      code: 'ACTIVE_SITE_REQUIRED',
      message:
        'No active site is set for this session. Use GET /api/me/sites then PATCH /api/me/active-site to select a site.',
    });
  }
}
