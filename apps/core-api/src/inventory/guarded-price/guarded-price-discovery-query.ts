import { InventoryPriceOperationState, Prisma } from '@prisma/client';
import { GUARDED_PRICE_RETENTION_MS } from './guarded-price.constants.js';

/** Retention rule shared by discovery list and get: ACCEPTED always, terminal rows until `final_at` (or `accepted_at`) passes the cutoff. */
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
