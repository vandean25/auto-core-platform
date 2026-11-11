import { randomInt } from 'node:crypto';

export function generatePurchaseOrderNumber(now: Date = new Date()): string {
  return `PO-${now.getFullYear()}-${randomInt(0, 10000)
    .toString()
    .padStart(4, '0')}`;
}
