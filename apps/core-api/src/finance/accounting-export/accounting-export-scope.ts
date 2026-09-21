import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';

export type AccountingExportSite = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export async function listAccountingExportSites(
  prisma: PrismaService,
  tenantId: string,
  legalEntityId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<AccountingExportSite[]> {
  const invoiceSiteIds = await prisma.invoice.findMany({
    where: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      site_id: { not: null },
      status: { in: ['FINALIZED', 'ISSUED', 'PAID'] },
      date: { gte: dateFrom, lte: dateTo },
    },
    select: { site_id: true },
    distinct: ['site_id'],
  });

  const creditSiteIds = await prisma.creditNote.findMany({
    where: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      status: 'FINALIZED',
      date: { gte: dateFrom, lte: dateTo },
    },
    select: { site_id: true },
    distinct: ['site_id'],
  });

  const siteIds = [
    ...new Set(
      [...invoiceSiteIds, ...creditSiteIds]
        .map((row) => row.site_id)
        .filter((siteId): siteId is string => Boolean(siteId)),
    ),
  ];

  if (siteIds.length === 0) {
    return [];
  }

  const sites = await prisma.site.findMany({
    where: { tenant_id: tenantId, id: { in: siteIds } },
    select: { id: true, code: true, name: true, is_active: true },
    orderBy: { code: 'asc' },
  });

  return sites.map((site) => ({
    id: site.id,
    code: site.code,
    name: site.name,
    isActive: site.is_active,
  }));
}

export async function assertCompleteAccountingExportScope(
  prisma: PrismaService,
  tenantId: string,
  userId: string,
  sites: AccountingExportSite[],
): Promise<void> {
  if (sites.length === 0) {
    return;
  }

  const inactiveSites = sites.filter((site) => !site.isActive);
  if (inactiveSites.length > 0) {
    throw new ForbiddenException({
      code: 'EXPORT_SCOPE_INCOMPLETE',
      message: 'Export scope is incomplete for inactive contributing sites.',
    });
  }

  const memberships = await prisma.siteMembership.findMany({
    where: {
      tenant_id: tenantId,
      user_id: userId,
      site_id: { in: sites.map((site) => site.id) },
      is_active: true,
    },
    select: { site_id: true },
  });

  const coveredSiteIds = new Set(memberships.map((row) => row.site_id));
  const missingAccess = sites.some((site) => !coveredSiteIds.has(site.id));
  if (missingAccess) {
    throw new ForbiddenException({
      code: 'EXPORT_SCOPE_INCOMPLETE',
      message: 'Export scope is incomplete for the current user.',
    });
  }
}
