import { InventoryPriceOperationState } from '@prisma/client';
import { GUARDED_PRICE_KIND } from '../../src/inventory/guarded-price/guarded-price.errors.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

export type PriceFenceDiscoveryE2EContext = {
  tenantId: string;
  principalId: string;
  tenantPrisma: () => PrismaService;
  seedItem: (retail?: number, sku?: string) => Promise<{ id: string; sku: string }>;
  operationKeyAt: (ms: number, suffix?: string) => string;
};

export async function createAppliedGhostWithDeletedCatalog(
  ctx: PriceFenceDiscoveryE2EContext,
  anchor: number,
  index: number,
  skuPrefix: string,
): Promise<void> {
  const ghost = await ctx.seedItem(10, `${skuPrefix}-${index}`);
  await ctx.tenantPrisma().inventoryPriceOperation.create({
    data: {
      tenant_id: ctx.tenantId,
      principal_id: ctx.principalId,
      key: ctx.operationKeyAt(anchor - index * 1000, String(index).padStart(4, '0')),
      item_id: ghost.id,
      sku: ghost.sku,
      kind: GUARDED_PRICE_KIND,
      expected_revision: BigInt(1),
      target_minor: BigInt(1500),
      basis_minor: BigInt(1000),
      state: InventoryPriceOperationState.APPLIED,
      accepted_at: new Date(anchor - index * 1000),
      final_at: new Date(anchor - index * 1000),
    },
  });
  await ctx.tenantPrisma().catalogItem.delete({ where: { id: ghost.id } });
}

export async function updatePriceOperationAcceptedAt(
  ctx: PriceFenceDiscoveryE2EContext,
  key: string,
  acceptedAt: Date,
): Promise<void> {
  await ctx.tenantPrisma().inventoryPriceOperation.update({
    where: {
      tenant_id_principal_id_key: {
        tenant_id: ctx.tenantId,
        principal_id: ctx.principalId,
        key,
      },
    },
    data: { accepted_at: acceptedAt },
  });
}

export async function seedGhostsWithDeletedCatalog(
  ctx: PriceFenceDiscoveryE2EContext,
  anchor: number,
  count: number,
  skuPrefix: string,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await createAppliedGhostWithDeletedCatalog(ctx, anchor, i, skuPrefix);
  }
}
