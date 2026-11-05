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
