import { Injectable } from '@nestjs/common';
import { DisplayLanguage } from '@prisma/client';
import { assertTenantAdmin } from '../site/site.authorization.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  TenantLocaleSettingsResponseDto,
} from '../auth/dto/user-locale-preferences.dto.js';

@Injectable()
export class TenantLocaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getCurrent(): Promise<TenantLocaleSettingsResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, is_active: true },
      select: { default_locale: true, format_locale: true },
    });
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }
    return {
      default_locale: tenant.default_locale,
      format_locale: tenant.format_locale,
    };
  }

  async patchCurrent(
    defaultLocale: DisplayLanguage,
  ): Promise<TenantLocaleSettingsResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { default_locale: defaultLocale },
      select: { default_locale: true, format_locale: true },
    });
    return {
      default_locale: tenant.default_locale,
      format_locale: tenant.format_locale,
    };
  }
}
