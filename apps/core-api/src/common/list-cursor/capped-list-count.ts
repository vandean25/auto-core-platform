import type { Prisma } from '@prisma/client';
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
  db: {
    catalogItem: Pick<Prisma.TransactionClient['catalogItem'], 'findMany'>;
  },
  where: Prisma.CatalogItemWhereInput,
): Promise<CappedListCountResult> {
  const rows = await db.catalogItem.findMany({
    where,
    select: { id: true },
    take: LIST_COUNT_PROBE_TAKE,
  });
  return cappedCountFromRows(rows);
}

/** Bounded match count for dealer stock vehicles (ADR-0035 §5). */
export async function cappedVehicleListCount(
  db: { vehicle: Pick<Prisma.TransactionClient['vehicle'], 'findMany'> },
  where: Prisma.VehicleWhereInput,
): Promise<CappedListCountResult> {
  const rows = await db.vehicle.findMany({
    where,
    select: { id: true },
    take: LIST_COUNT_PROBE_TAKE,
  });
  return cappedCountFromRows(rows);
}

/** Bounded match count for the invoice list (ADR-0035 §5). */
export async function cappedInvoiceListCount(
  db: { invoice: Pick<Prisma.TransactionClient['invoice'], 'findMany'> },
  where: Prisma.InvoiceWhereInput,
): Promise<CappedListCountResult> {
  const rows = await db.invoice.findMany({
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
  db: {
    workshopOrder: Pick<Prisma.TransactionClient['workshopOrder'], 'findMany'>;
  },
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
