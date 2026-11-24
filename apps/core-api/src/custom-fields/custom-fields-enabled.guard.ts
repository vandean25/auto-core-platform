import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CUSTOM_FIELDS_DISABLED_CODE } from './custom-fields.constants.js';

@Injectable()
export class CustomFieldsEnabledGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(): Promise<boolean> {
    const tenantId = await this.tenantContext.getTenantId();
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { custom_fields_enabled: true },
    });
    if (!tenant?.custom_fields_enabled) {
      throw new ForbiddenException({
        code: CUSTOM_FIELDS_DISABLED_CODE,
        message: 'Custom fields are not enabled for this tenant.',
      });
    }
    return true;
  }
}
