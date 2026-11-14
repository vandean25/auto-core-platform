import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  LIST_COUNT_CAP,
  LIST_COUNT_PROBE_TAKE,
} from './list-cursor.constants.js';

export type CappedListCountResult = {
  count: number;
  isCapped: boolean;
};

function cappedCountFromRows(
  rows: readonly { id: string }[],
): CappedListCountResult {
  if (rows.length >= LIST_COUNT_PROBE_TAKE) {
    return { count: LIST_COUNT_CAP, isCapped: true };
  }
  return { count: rows.length, isCapped: false };
}

/** Bounded match count for catalog items (ADR-0035 §5). */
export async function cappedCatalogItemListCount(
  prisma: PrismaService,
  where: Prisma.CatalogItemWhereInput,
): Promise<CappedListCountResult> {
  const rows = await prisma.catalogItem.findMany({
    where,
    select: { id: true },
    take: LIST_COUNT_PROBE_TAKE,
  });
  return cappedCountFromRows(rows);
}

/** Bounded match count for dealer stock vehicles (ADR-0035 §5). */
export async function cappedVehicleListCount(
  prisma: PrismaService,
  where: Prisma.VehicleWhereInput,
): Promise<CappedListCountResult> {
  const rows = await prisma.vehicle.findMany({
    where,
    select: { id: true },
    take: LIST_COUNT_PROBE_TAKE,
  });
  return cappedCountFromRows(rows);
}

/** Bounded match count for the invoice list (ADR-0035 §5). */
export async function cappedInvoiceListCount(
  prisma: PrismaService,
  where: Prisma.InvoiceWhereInput,
): Promise<CappedListCountResult> {
  const rows = await prisma.invoice.findMany({
    where,
    select: { id: true },
    take: LIST_COUNT_PROBE_TAKE,
  });
  return cappedCountFromRows(rows);
}

/**
 * Bounded match count for the workshop order list (ADR-0035 §5). Takes the transaction client so the
 * count runs inside the scope-context snapshot (ADR-0038 §4).
 */
export async function cappedWorkshopOrderListCount(
  db: Pick<Prisma.TransactionClient, 'workshopOrder'>,
  scope: { tenantId: string; siteId: string },
  where: Prisma.WorkshopOrderWhereInput,
): Promise<CappedListCountResult> {
  const rows = await db.workshopOrder.findMany({
    where: {
      AND: [where, { tenant_id: scope.tenantId, site_id: scope.siteId }],
    },
    select: { id: true },
    take: LIST_COUNT_PROBE_TAKE,
  });
  return cappedCountFromRows(rows);
}
