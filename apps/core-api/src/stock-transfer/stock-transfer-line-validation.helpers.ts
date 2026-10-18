import { UnprocessableEntityException } from '@nestjs/common';
import { LocationType, Prisma } from '@prisma/client';

import Decimal = Prisma.Decimal;

export function assertUniqueLineIds(ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new UnprocessableEntityException(
        `Duplicate line id ${id} in request.`,
      );
    }
    seen.add(id);
  }
}

export async function assertSourceBinsValid(
  tx: Prisma.TransactionClient,
  tenantId: string,
  fromSiteId: string,
  locationIds: string[],
): Promise<void> {
  if (locationIds.length === 0) {
    return;
  }
  const unique = [...new Set(locationIds)];
  const locations = await tx.storageLocation.findMany({
    where: { tenant_id: tenantId, site_id: fromSiteId, id: { in: unique } },
    select: { id: true, site_id: true, type: true, deletedAt: true },
  });
  if (locations.length !== unique.length) {
    throw new UnprocessableEntityException(
      'Source location not found on the from-site.',
    );
  }
  for (const location of locations) {
    if (
      location.site_id !== fromSiteId ||
      location.type !== LocationType.bin ||
      location.deletedAt
    ) {
      throw new UnprocessableEntityException(
        `Location ${location.id} is not an active bin on the from-site.`,
      );
    }
  }
}

export async function assertDestBinsValid(
  tx: Prisma.TransactionClient,
  tenantId: string,
  toSiteId: string,
  locationIds: string[],
): Promise<void> {
  if (locationIds.length === 0) {
    return;
  }
  const unique = [...new Set(locationIds)];
  const locations = await tx.storageLocation.findMany({
    where: { tenant_id: tenantId, site_id: toSiteId, id: { in: unique } },
    select: { id: true, site_id: true, type: true, deletedAt: true },
  });
  if (locations.length !== unique.length) {
    throw new UnprocessableEntityException(
      'Destination location not found on the to-site.',
    );
  }
  for (const location of locations) {
    if (
      location.site_id !== toSiteId ||
      location.type !== LocationType.bin ||
      location.deletedAt
    ) {
      throw new UnprocessableEntityException(
        `Location ${location.id} is not an active bin on the to-site.`,
      );
    }
  }
}

/**
 * Ruling 33: ship availability is atomic against on-hand minus reserved at
 * the source bins, under the ADR-0021 stock-row lock order (sorted ids).
 */
export async function assertShipAvailability(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  demands: Array<{ itemId: string; locationId: string; quantity: Decimal }>,
): Promise<void> {
  const demandsByStock = new Map<string, Decimal>();
  for (const demand of demands) {
    const key = `${demand.itemId}:${demand.locationId}`;
    demandsByStock.set(
      key,
      (demandsByStock.get(key) ?? new Decimal(0)).add(demand.quantity),
    );
  }

  const candidateStocks = await tx.inventoryStock.findMany({
    where: {
      tenant_id: tenantId,
      site_id: siteId,
      OR: [...demandsByStock.keys()].map((key) => {
        const [itemId, locationId] = key.split(':');
        return { catalog_item_id: itemId, location_id: locationId };
      }),
    },
    select: { id: true },
  });
  const sortedIds = candidateStocks.map((stock) => stock.id).sort();
  if (sortedIds.length === 0) {
    throw new UnprocessableEntityException(
      'No stock rows found for the requested source bins.',
    );
  }
  // eslint-disable-next-line no-restricted-syntax -- ADR-0021 lock hierarchy: sorted stock-row locks under the site locks.
  const lockedStocks = await tx.$queryRaw<
    Array<{
      id: string;
      catalog_item_id: string;
      location_id: string;
      quantity_on_hand: Decimal;
      quantity_reserved: Decimal;
    }>
  >`
      SELECT id, catalog_item_id, location_id, quantity_on_hand, quantity_reserved
      FROM "inventory_stocks"
      WHERE tenant_id = ${tenantId}
        AND id IN (${Prisma.join(sortedIds)})
      ORDER BY id
      FOR UPDATE
    `;

  for (const [key, quantity] of demandsByStock) {
    const [itemId, locationId] = key.split(':');
    const stock = lockedStocks.find(
      (row) =>
        row.catalog_item_id === itemId && row.location_id === locationId,
    );
    const available = stock
      ? new Decimal(stock.quantity_on_hand).minus(
          new Decimal(stock.quantity_reserved),
        )
      : new Decimal(0);
    if (available.lt(quantity)) {
      throw new UnprocessableEntityException(
        `Insufficient available stock for item ${itemId} at location ${locationId}.`,
      );
    }
  }
}
