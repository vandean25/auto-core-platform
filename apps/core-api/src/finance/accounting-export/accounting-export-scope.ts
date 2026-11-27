import { ForbiddenException } from '@nestjs/common';
import { InvoiceStatus, TransactionType } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { buildExportDocumentDateFilter } from './accounting-export-period.js';

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
  const dateFilter = buildExportDocumentDateFilter(dateFrom, dateTo);
  const entitySites = await prisma.site.findMany({
    where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
    select: { id: true },
  });
  const entitySiteIds = entitySites.map((site) => site.id);

  const [invoiceSiteIds, creditSiteIds, adjustmentSiteIds] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        site_id: { not: null },
        status: {
          in: [
            InvoiceStatus.FINALIZED,
            InvoiceStatus.ISSUED,
            InvoiceStatus.PAID,
            InvoiceStatus.CANCELLED,
          ],
        },
        date: dateFilter,
      },
      select: { site_id: true },
      distinct: ['site_id'],
    }),
    prisma.creditNote.findMany({
      where: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        status: 'FINALIZED',
        date: dateFilter,
      },
      select: { site_id: true },
      distinct: ['site_id'],
    }),
    entitySiteIds.length > 0
      ? prisma.inventoryTransaction.findMany({
          where: {
            tenant_id: tenantId,
            site_id: { in: entitySiteIds },
            type: TransactionType.ADJUSTMENT,
            cost_basis: { not: null },
            createdAt: dateFilter,
          },
          select: { site_id: true },
          distinct: ['site_id'],
        })
      : Promise.resolve([]),
  ]);

  const siteIds = [
    ...new Set(
      [...invoiceSiteIds, ...creditSiteIds, ...adjustmentSiteIds]
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
