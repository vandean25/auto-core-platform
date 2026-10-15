import { LocationType, Prisma } from '@prisma/client';

export type McpStockBinLevel = {
  location_id: string;
  name: string;
  code: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
};

type StockRow = {
  catalog_item_id: string;
  location_id: string;
  quantity_on_hand: Prisma.Decimal;
  quantity_reserved: Prisma.Decimal;
  location: { name: string; code: string };
};

function toQuantity(value: Prisma.Decimal): number {
  return Number(value);
}

function toBinLevel(stock: StockRow): McpStockBinLevel {
  const onHand = toQuantity(stock.quantity_on_hand);
  const reserved =
    stock.quantity_reserved === undefined
      ? 0
      : toQuantity(stock.quantity_reserved);
  return {
    location_id: stock.location_id,
    name: stock.location.name,
    code: stock.location.code,
    quantity_on_hand: onHand,
    quantity_reserved: reserved,
    quantity_available: onHand - reserved,
  };
}

/** Shared with get_catalog_item default_bin: most available ATP, then lowest location_id. */
export function compareBinsForPrimarySelection(
  left: McpStockBinLevel,
  right: McpStockBinLevel,
): number {
  if (right.quantity_available !== left.quantity_available) {
    return right.quantity_available - left.quantity_available;
  }
  return left.location_id.localeCompare(right.location_id);
}

export function pickPrimaryBin(
  bins: McpStockBinLevel[],
): McpStockBinLevel | null {
  const withAvailability = bins.filter((bin) => bin.quantity_available > 0);
  if (withAvailability.length === 0) {
    return null;
  }
  return withAvailability.reduce((best, current) =>
    compareBinsForPrimarySelection(best, current) > 0 ? current : best,
  );
}

export function mapInventoryStocksToBinLevels(
  stocks: StockRow[],
): Map<string, McpStockBinLevel[]> {
  const byItem = new Map<string, McpStockBinLevel[]>();
  for (const stock of stocks) {
    const levels = byItem.get(stock.catalog_item_id) ?? [];
    levels.push(toBinLevel(stock));
    byItem.set(stock.catalog_item_id, levels);
  }
  for (const levels of byItem.values()) {
    levels.sort(compareBinsForPrimarySelection);
  }
  return byItem;
}

export function binFieldsFromLevels(bins: McpStockBinLevel[]) {
  const primary = pickPrimaryBin(bins);
  return {
    bin_id: primary?.location_id ?? null,
    bin_label: primary ? primary.name || primary.code : null,
  };
}

export const mcpStockBinStockSelect = {
  catalog_item_id: true,
  location_id: true,
  quantity_on_hand: true,
  quantity_reserved: true,
  location: { select: { name: true, code: true } },
} as const;

export function mcpStockBinWhere(
  tenantId: string,
  siteId: string,
  catalogItemIds: string[],
) {
  return {
    tenant_id: tenantId,
    site_id: siteId,
    catalog_item_id: { in: catalogItemIds },
    location: {
      type: LocationType.bin,
      deletedAt: null,
      site_id: siteId,
      tenant_id: tenantId,
    },
  };
}
