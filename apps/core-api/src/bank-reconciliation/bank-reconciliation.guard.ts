import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';

@Injectable()
export class BankReconciliationEnabledGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(): Promise<boolean> {
    const tenantId = await this.tenantContext.getTenantId();
    const settings = await this.prisma.financeSettings.findFirst({
      where: { tenant_id: tenantId },
      select: { bank_reconciliation_enabled: true },
    });
    if (!settings?.bank_reconciliation_enabled) {
      throw new NotFoundException();
    }
    assertTenantAdmin(this.tenantContext);
    return true;
  }
}
