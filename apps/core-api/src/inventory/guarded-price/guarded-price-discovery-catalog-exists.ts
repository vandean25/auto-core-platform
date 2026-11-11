import type { InventoryPriceOperation } from '@prisma/client';

type CatalogExistsClient = {
  catalogItem: {
    findMany: (args: {
      where: { tenant_id: string; id: { in: string[] } };
      select: { id: true };
    }) => Promise<{ id: string }[]>;
    findFirst: (args: {
      where: { tenant_id: string; id: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

export async function filterDiscoveryRowsWithExistingCatalog(
  prisma: CatalogExistsClient,
  tenantId: string,
  rows: readonly InventoryPriceOperation[],
): Promise<InventoryPriceOperation[]> {
  const itemIds = [...new Set(rows.map((row) => row.item_id))];
  if (itemIds.length === 0) {
    return [];
  }
  const existing = await prisma.catalogItem.findMany({
    where: { tenant_id: tenantId, id: { in: itemIds } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((row) => row.id));
  return rows.filter((row) => existingIds.has(row.item_id));
}

export async function discoveryCatalogItemExists(
  prisma: CatalogExistsClient,
  tenantId: string,
  itemId: string,
): Promise<boolean> {
  const row = await prisma.catalogItem.findFirst({
    where: { tenant_id: tenantId, id: itemId },
    select: { id: true },
  });
  return row !== null;
}
