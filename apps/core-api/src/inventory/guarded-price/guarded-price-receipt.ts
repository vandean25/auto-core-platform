import type { CatalogItem, InventoryPriceOperation } from '@prisma/client';
import type { GuardedPriceReceiptDto } from '../dto/guarded-inventory-price.dto.js';
import { minorUnitsToDecimalString } from './guarded-price.money.js';
import { outcomeUnavailable } from './guarded-price.errors.js';
import { revisionFromDb } from './guarded-price.revision.js';

export function receiptFromAppliedJournal(
  journal: InventoryPriceOperation,
  item: CatalogItem | null,
): GuardedPriceReceiptDto {
  if (journal.result_revision === null) {
    outcomeUnavailable('Stored guarded price outcome is incomplete.');
  }
  if (!item) {
    outcomeUnavailable('Catalog item for the stored outcome is not available.');
  }
  return {
    id: journal.item_id,
    sku: journal.sku,
    name: item.name,
    cost_price: item.cost_price?.toString() ?? null,
    retail_price: minorUnitsToDecimalString(journal.target_minor),
    unit: item.unit,
    brand_id: item.brand_id,
    revenue_group_id: item.revenue_group_id,
    revision: revisionFromDb(journal.result_revision),
  };
}
