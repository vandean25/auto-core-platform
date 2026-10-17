import { Injectable } from '@nestjs/common';
import type { DisplayLanguage } from '@prisma/client';
import { DEFAULT_DISPLAY_LANGUAGE } from '../common/i18n/display-language.js';
import { resolveUserLanguage } from '../common/i18n/locale-resolution.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';

@Injectable()
export class McpUserLocaleService {
  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async resolveEffectiveLocaleForSession(): Promise<DisplayLanguage> {
    const principal = this.tenantContext.getAuthenticatedUser();
    if (!principal?.tenantId) {
      return DEFAULT_DISPLAY_LANGUAGE;
    }

    const user = await this.systemPrisma.user.findFirst({
      where: { firebaseUid: principal.userId },
      select: {
        locale: true,
        memberships: {
          where: {
            is_active: true,
            tenant_id: principal.tenantId,
            tenant: { is_active: true },
          },
          select: {
            tenant: { select: { default_locale: true } },
          },
          take: 1,
        },
      },
    });

    const tenantDefault =
      user?.memberships[0]?.tenant.default_locale ?? DEFAULT_DISPLAY_LANGUAGE;
    return resolveUserLanguage(user?.locale, tenantDefault);
  }
}
