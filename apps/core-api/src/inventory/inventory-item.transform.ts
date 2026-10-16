import { LocationType, Prisma } from '@prisma/client';
import type { AtpService, AtpStockInput } from './atp.service.js';

type CatalogItemWithStocksAndBrand = Prisma.CatalogItemGetPayload<{
  include: {
    brand: true;
    stocks: { include: { location: true } };
    superseded_by: { select: { id: true; sku: true } };
  };
}>;

export function toAtpStockInput(
  stock: CatalogItemWithStocksAndBrand['stocks'][number],
): AtpStockInput {
  return {
    id: stock.id,
    locationId: stock.location_id,
    quantity_on_hand: stock.quantity_on_hand,
    quantity_reserved: stock.quantity_reserved,
  };
}

export function filterAtpStocks(
  stocks: CatalogItemWithStocksAndBrand['stocks'],
  siteId: string,
) {
  return stocks.filter(
    (stock) =>
      stock.location.site_id === siteId &&
      stock.location.type !== LocationType.staging_tote &&
      stock.location.type !== LocationType.in_transit,
  );
}

export function transformInventoryListItem(
  item: CatalogItemWithStocksAndBrand,
  atpService: AtpService,
  siteId: string,
) {
  const eligibleStocks = filterAtpStocks(item.stocks, siteId);
  const totals = atpService.sumAtp(eligibleStocks.map(toAtpStockInput), {
    operation: 'inventory_list',
    tenantId: item.tenant_id,
  });
  const available = totals.quantityAvailable.toNumber();

  let status: 'IN_STOCK' | 'OUT_OF_STOCK' | 'SUPERSEDED';
  if (item.superseded_by) {
    status = 'SUPERSEDED';
  } else if (totals.quantityAvailable.gt(0)) {
    status = 'IN_STOCK';
  } else {
    status = 'OUT_OF_STOCK';
  }

  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    brand: item.brand?.name || '',
    brand_id: item.brand_id,
    price: Number(item.retail_price),
    status,
    quantity_available: available,
    warehouse_location: eligibleStocks[0]?.location?.name || 'N/A',
  };
}

export function transformInventoryDetailItem(
  item: CatalogItemWithStocksAndBrand,
  atpService: AtpService,
  siteId: string,
) {
  return {
    ...transformInventoryListItem(item, atpService, siteId),
    cost_price: Number(item.cost_price ?? 0),
  };
}

export type { CatalogItemWithStocksAndBrand };
