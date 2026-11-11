import { Prisma, type InventoryPriceOperation } from '@prisma/client';

type CatalogExistsClient = {
  $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
  catalogItem: {
    findFirst: (args: {
      where: { tenant_id: string; id: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

/** Catalog ids that still exist for this tenant (bounded batch, not full-catalog load). */
export async function catalogItemIdsExistingInTenant(
  prisma: CatalogExistsClient,
  tenantId: string,
  itemIds: readonly string[],
): Promise<Set<string>> {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) {
    return new Set();
  }
  // eslint-disable-next-line no-restricted-syntax -- AUT-930: FK-free journal→catalog semi-join; Prisma cannot express EXISTS without a DB FK; tenant_id bound, ids via Prisma.join.
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id
      FROM catalog_items
      WHERE tenant_id = ${tenantId}
        AND id IN (${Prisma.join(uniqueIds)})
    `,
  );
  return new Set(rows.map((row) => row.id));
}

export async function filterDiscoveryRowsWithExistingCatalog(
  prisma: CatalogExistsClient,
  tenantId: string,
  rows: readonly InventoryPriceOperation[],
): Promise<InventoryPriceOperation[]> {
  const existingIds = await catalogItemIdsExistingInTenant(
    prisma,
    tenantId,
    rows.map((row) => row.item_id),
  );
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
