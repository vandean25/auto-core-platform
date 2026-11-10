import { InventoryPriceOperationState } from '@prisma/client';
import { GUARDED_PRICE_RETENTION_MS } from './guarded-price.constants.js';
import { uuidV7TimestampMillis } from './guarded-price.uuid.js';

type RetentionRow = {
  state: InventoryPriceOperationState;
  final_at: Date | null;
  key: string;
};

export function retentionAnchorMs(row: RetentionRow): number {
  const keyTime = uuidV7TimestampMillis(row.key) ?? 0;
  const finalMs = row.final_at?.getTime() ?? 0;
  return Math.max(finalMs, keyTime);
}

export function rowWithinRetention(
  row: RetentionRow,
  now = Date.now(),
): boolean {
  if (row.state === InventoryPriceOperationState.ACCEPTED) {
    return true;
  }
  return now - retentionAnchorMs(row) < GUARDED_PRICE_RETENTION_MS;
}
