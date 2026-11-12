import {
  InventoryPriceOperation,
  InventoryPriceOperationState,
} from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { GUARDED_PRICE_DISCOVERY_PAGE_SIZE } from './guarded-price.constants.js';
import type { PriceOperationDiscoveryCursor } from './guarded-price-discovery-cursor.js';
import {
  buildDiscoveryKeysetWhere,
  discoveryRetentionWhere,
} from './guarded-price-discovery-query.js';

const DISCOVERY_STATES = [
  InventoryPriceOperationState.ACCEPTED,
  InventoryPriceOperationState.APPLIED,
  InventoryPriceOperationState.CONFLICT,
  InventoryPriceOperationState.FENCED,
] as const;

/**
 * Keyset journal page: retention + principal + catalog EXISTS semi-join in one query.
 */
export async function fetchGuardedPriceDiscoveryPage(
  prisma: PrismaService,
  tenantId: string,
  principalId: string,
  cursor: PriceOperationDiscoveryCursor | null,
  take = GUARDED_PRICE_DISCOVERY_PAGE_SIZE + 1,
): Promise<InventoryPriceOperation[]> {
  return prisma.inventoryPriceOperation.findMany({
    where: {
      AND: [
        {
          tenant_id: tenantId,
          principal_id: principalId,
          state: { in: [...DISCOVERY_STATES] },
          catalog_item: { is: { tenant_id: tenantId } },
        },
        discoveryRetentionWhere(),
        buildDiscoveryKeysetWhere(cursor),
      ],
    },
    orderBy: [{ accepted_at: 'desc' }, { key: 'desc' }],
    take,
  });
}
