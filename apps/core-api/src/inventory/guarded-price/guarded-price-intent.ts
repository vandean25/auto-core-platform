import type { InventoryPriceOperation } from '@prisma/client';
import { GUARDED_PRICE_KIND } from './guarded-price.errors.js';

export type GuardedPriceIntent = {
  itemId: string;
  expectedRevision: number;
  targetMinor: bigint;
  basisMinor: bigint;
  sku: string;
};

export function frozenIntentMatchesRow(
  row: Pick<
    InventoryPriceOperation,
    'item_id' | 'expected_revision' | 'target_minor' | 'kind'
  >,
  intent: GuardedPriceIntent,
): boolean {
  return (
    row.item_id === intent.itemId &&
    row.kind === GUARDED_PRICE_KIND &&
    row.expected_revision === BigInt(intent.expectedRevision) &&
    row.target_minor === intent.targetMinor
  );
}
