import type { InventoryPriceOperation, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { GUARDED_PRICE_DISCOVERY_PAGE_SIZE } from './guarded-price.constants.js';
import type { PriceOperationDiscoveryCursor } from './guarded-price-discovery-cursor.js';
import { discoveryRetentionWhere } from './guarded-price-discovery-query.js';

export type GuardedPriceDiscoveryPage = {
  /** Scanned rows whose catalog item still exists (may be shorter than a full page). */
  page: InventoryPriceOperation[];
  hasNextPage: boolean;
  /** Last scanned row, visible or not: the next cursor must start after it. */
  scanTail: InventoryPriceOperation | null;
};

function keysetWhere(
  cursor: PriceOperationDiscoveryCursor | null,
): Prisma.InventoryPriceOperationWhereInput {
  if (!cursor) {
    return {};
  }
  const acceptedAt = new Date(cursor.acceptedAt);
  return {
    OR: [
      { accepted_at: { lt: acceptedAt } },
      { accepted_at: acceptedAt, key: { lt: cursor.key } },
    ],
  };
}

/**
 * One keyset journal read (page + 1) and one catalog read for at most a page of ids.
 * Rows of hard-deleted catalog items are dropped after the scan; the journal has no
 * relation to `catalog_items` so the restore manifest expects no FK that would block
 * those deletes.
 */
export async function fetchGuardedPriceDiscoveryPage(
  prisma: PrismaService,
  tenantId: string,
  principalId: string,
  cursor: PriceOperationDiscoveryCursor | null,
): Promise<GuardedPriceDiscoveryPage> {
  const scanned = await prisma.inventoryPriceOperation.findMany({
    where: {
      AND: [
        { tenant_id: tenantId, principal_id: principalId },
        discoveryRetentionWhere(),
        keysetWhere(cursor),
      ],
    },
    orderBy: [{ accepted_at: 'desc' }, { key: 'desc' }],
    take: GUARDED_PRICE_DISCOVERY_PAGE_SIZE + 1,
  });
  const window = scanned.slice(0, GUARDED_PRICE_DISCOVERY_PAGE_SIZE);
  const liveItems = window.length
    ? await prisma.catalogItem.findMany({
        where: {
          tenant_id: tenantId,
          id: { in: [...new Set(window.map((row) => row.item_id))] },
        },
        select: { id: true },
      })
    : [];
  const liveIds = new Set(liveItems.map((item) => item.id));
  return {
    page: window.filter((row) => liveIds.has(row.item_id)),
    hasNextPage: scanned.length > GUARDED_PRICE_DISCOVERY_PAGE_SIZE,
    scanTail: window.at(-1) ?? null,
  };
}
