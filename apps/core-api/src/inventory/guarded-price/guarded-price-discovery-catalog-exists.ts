type CatalogExistsClient = {
  catalogItem: {
    findFirst: (args: {
      where: { tenant_id: string; id: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
};

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
