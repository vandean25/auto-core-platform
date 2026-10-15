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
  const reserved = toQuantity(stock.quantity_reserved);
  return {
    location_id: stock.location_id,
    name: stock.location.name,
    code: stock.location.code,
    quantity_on_hand: onHand,
    quantity_reserved: reserved,
    quantity_available: onHand - reserved,
  };
}

/** Highest on-hand bin stock for an item, matching get_catalog_item default_bin selection. */
export function pickPrimaryBin(
  bins: McpStockBinLevel[],
): McpStockBinLevel | null {
  const withStock = bins.filter((bin) => bin.quantity_on_hand > 0);
  if (withStock.length === 0) {
    return null;
  }
  return withStock.reduce((best, current) => {
    if (current.quantity_on_hand > best.quantity_on_hand) {
      return current;
    }
    if (
      current.quantity_on_hand === best.quantity_on_hand &&
      current.location_id < best.location_id
    ) {
      return current;
    }
    return best;
  });
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
    levels.sort((left, right) => {
      if (right.quantity_on_hand !== left.quantity_on_hand) {
        return right.quantity_on_hand - left.quantity_on_hand;
      }
      return left.location_id.localeCompare(right.location_id);
    });
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
