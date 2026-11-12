import { InventoryPriceOperationState, Prisma } from '@prisma/client';
import { GUARDED_PRICE_RETENTION_MS } from './guarded-price.constants.js';

/** Prisma filter matching `rowWithinRetention` (ACCEPTED always eligible); the discovery list mirrors it in SQL. */
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
