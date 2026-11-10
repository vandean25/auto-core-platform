import type { InventoryPriceOperation } from '@prisma/client';
import type { InventoryPriceOperationDto } from '../dto/inventory-price-operation.dto.js';
import { minorUnitsToDecimalString } from './guarded-price.money.js';
import { revisionFromDb } from './guarded-price.revision.js';

export function mapInventoryPriceOperation(
  row: InventoryPriceOperation,
): InventoryPriceOperationDto {
  return {
    key: row.key,
    itemId: row.item_id,
    sku: row.sku,
    state: row.state,
    kind: row.kind,
    expectedRevision: revisionFromDb(row.expected_revision),
    retail_price: minorUnitsToDecimalString(row.target_minor),
    basis_retail_price: minorUnitsToDecimalString(row.basis_minor),
    acceptedAt: row.accepted_at.toISOString(),
    finalAt: row.final_at?.toISOString() ?? null,
    errorCode: row.error_code,
  };
}
