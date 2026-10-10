import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { SystemPrismaService } from '../../prisma/system-prisma.service.js';
import { TenantContextService } from './tenant-context.service.js';

const ACTIVE_SITE_REQUIRED_CODE = 'ACTIVE_SITE_REQUIRED';

const ACTIVE_SITE_REQUIRED_MESSAGE =
  'An active site is required for this operation.';

@Injectable()
export class SiteContextService {
  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getSiteId(): Promise<string> {
    const siteId = await this.findSiteId();
    if (!siteId) {
      throw this.createActiveSiteRequiredException();
    }
    return siteId;
  }

  /**
   * Active site for the session when its membership is still valid, otherwise
   * null. Unlike getSiteId this never throws, so read-only callers can report
   * "no active site" without treating it as an error.
   */
  async findSiteId(): Promise<string | null> {
    const user = this.tenantContext.getAuthenticatedUser();
    const activeSiteId =
      user && 'activeSiteId' in user ? user.activeSiteId : undefined;

    if (!user?.tenantId || !activeSiteId) {
      return null;
    }

    const activeSite = await this.systemPrisma.user.findFirst({
      where: {
        firebaseUid: user.userId,
        active_tenant_id: user.tenantId,
        active_site_id: activeSiteId,
        memberships: {
          some: {
            tenant_id: user.tenantId,
            is_active: true,
          },
        },
        siteMemberships: {
          some: {
            tenant_id: user.tenantId,
            site_id: activeSiteId,
            is_active: true,
            site: { is_active: true },
          },
        },
      },
      select: { active_site_id: true },
    });

    return activeSite?.active_site_id ?? null;
  }

  private createActiveSiteRequiredException(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      message: ACTIVE_SITE_REQUIRED_MESSAGE,
      error: ACTIVE_SITE_REQUIRED_CODE,
    });
  }
}
