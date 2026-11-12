import { InventoryPriceOperation, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  GUARDED_PRICE_DISCOVERY_PAGE_SIZE,
  GUARDED_PRICE_RETENTION_MS,
} from './guarded-price.constants.js';
import type { PriceOperationDiscoveryCursor } from './guarded-price-discovery-cursor.js';

function keysetSql(cursor: PriceOperationDiscoveryCursor | null): Prisma.Sql {
  if (!cursor) {
    return Prisma.empty;
  }
  return Prisma.sql`AND (op.accepted_at, op.key) < (${new Date(cursor.acceptedAt)}, ${cursor.key}::uuid)`;
}

/**
 * Keyset journal page: principal + retention (same rule as `discoveryRetentionWhere`)
 * + catalog EXISTS in one query. No Prisma relation to `catalog_items`: a relation
 * would make the tenant-restore manifest expect a RESTRICT FK that would block
 * catalog hard-deletes the journal must survive.
 */
export async function fetchGuardedPriceDiscoveryPage(
  prisma: PrismaService,
  tenantId: string,
  principalId: string,
  cursor: PriceOperationDiscoveryCursor | null,
  take = GUARDED_PRICE_DISCOVERY_PAGE_SIZE + 1,
): Promise<InventoryPriceOperation[]> {
  const cutoff = new Date(Date.now() - GUARDED_PRICE_RETENTION_MS);
  // eslint-disable-next-line no-restricted-syntax -- AUT-930: typed Prisma cannot express EXISTS on catalog_items without a relation, and a relation adds a RESTRICT FK to the restore manifest; tenant_id is bound in both predicates.
  return prisma.$queryRaw<InventoryPriceOperation[]>`
    SELECT op.*
    FROM inventory_price_operations op
    WHERE op.tenant_id = ${tenantId}
      AND op.principal_id = ${principalId}
      AND (
        op.state = 'ACCEPTED'
        OR (
          op.state IN ('APPLIED', 'CONFLICT', 'FENCED')
          AND (
            op.final_at >= ${cutoff}
            OR (op.final_at IS NULL AND op.accepted_at >= ${cutoff})
          )
        )
      )
      AND EXISTS (
        SELECT 1 FROM catalog_items ci
        WHERE ci.tenant_id = ${tenantId} AND ci.id = op.item_id
      )
      ${keysetSql(cursor)}
    ORDER BY op.accepted_at DESC, op.key DESC
    LIMIT ${take}
  `;
}
