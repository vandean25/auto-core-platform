import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { SystemPrismaService } from '../../prisma/system-prisma.service';
import { TenantContextService } from './tenant-context.service';

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
    const user = this.tenantContext.getAuthenticatedUser();
    const activeSiteId =
      user && 'activeSiteId' in user ? user.activeSiteId : undefined;

    if (!user?.tenantId || !activeSiteId) {
      throw this.createActiveSiteRequiredException();
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

    if (!activeSite?.active_site_id) {
      throw this.createActiveSiteRequiredException();
    }

    return activeSite.active_site_id;
  }

  private createActiveSiteRequiredException(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      message: ACTIVE_SITE_REQUIRED_MESSAGE,
      error: ACTIVE_SITE_REQUIRED_CODE,
    });
  }
}
