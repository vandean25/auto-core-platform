import { InventoryPriceOperationState, Prisma } from '@prisma/client';
import { GUARDED_PRICE_RETENTION_MS } from './guarded-price.constants.js';

/** SQL filter matching `rowWithinRetention` for list discovery (ACCEPTED always eligible). */
export function discoveryRetentionWhere(
  now = Date.now(),
): Prisma.InventoryPriceOperationWhereInput {
  const cutoff = new Date(now - GUARDED_PRICE_RETENTION_MS);
  return {
    OR: [
      { state: InventoryPriceOperationState.ACCEPTED },
      {
        state: {
          in: [
            InventoryPriceOperationState.APPLIED,
            InventoryPriceOperationState.CONFLICT,
            InventoryPriceOperationState.FENCED,
          ],
        },
        final_at: { gte: cutoff },
      },
      {
        state: {
          in: [
            InventoryPriceOperationState.APPLIED,
            InventoryPriceOperationState.CONFLICT,
            InventoryPriceOperationState.FENCED,
          ],
        },
        final_at: null,
        accepted_at: { gte: cutoff },
      },
    ],
  };
}

/** Rows whose catalog item still exists in the tenant. */
export function discoveryCatalogExistsWhere(
  catalogItemIds: string[],
): Prisma.InventoryPriceOperationWhereInput {
  if (catalogItemIds.length === 0) {
    return { item_id: { in: [] } };
  }
  return { item_id: { in: catalogItemIds } };
}
