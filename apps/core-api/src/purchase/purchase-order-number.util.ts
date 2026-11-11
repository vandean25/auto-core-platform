import { randomInt } from 'node:crypto';

export function generatePurchaseOrderNumber(now: Date = new Date()): string {
  // Six digits keeps the PO-YYYY-###### shape while avoiding rare collisions in parallel e2e creates.
  return `PO-${now.getFullYear()}-${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
}
