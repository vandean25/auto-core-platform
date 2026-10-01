import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { FinanceService } from '../finance/finance.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';

export function assertRequiredStringId(
  value: string,
  label: string,
): asserts value is string {
  if (!value) {
    throw new BadRequestException(`${label} is required`);
  }
}

export async function resolveWorkshopInvoiceDraftScope(deps: {
  tenantContext: TenantContextService;
  siteContext: SiteContextService;
  financeService: FinanceService;
}): Promise<{ tenantId: string; siteId: string }> {
  await deps.financeService.validateTransactionDate(new Date());
  const [tenantId, siteId] = await Promise.all([
    deps.tenantContext.getTenantId(),
    deps.siteContext.getSiteId(),
  ]);
  return { tenantId, siteId };
}

export async function runInvoiceTenantTransaction<T>(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  handler: (tx: Prisma.TransactionClient, tenantId: string) => Promise<T>,
): Promise<T> {
  const tenantId = await tenantContext.getTenantId();
  return prisma.$transaction((tx) => handler(tx, tenantId));
}
