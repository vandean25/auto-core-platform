import type { CatalogItem } from '@prisma/client';
import type { CatalogItemResponseDto } from './dto/inventory-response.dto.js';
import { catalogItemRevisionToJsonInteger } from './catalog-item-revision-json.util.js';

export type CatalogItemHttpEmbed = Omit<CatalogItem, 'revision'> & {
  revision: number;
};

export function toJsonSafeCatalogItem(item: CatalogItem): CatalogItemHttpEmbed {
  return {
    ...item,
    revision: catalogItemRevisionToJsonInteger(item.revision),
  };
}

export function embedCatalogItemForHttp<T extends { catalog_item?: CatalogItem | null }>(
  row: T,
): T {
  if (!('catalog_item' in row) || row.catalog_item === undefined) {
    return row;
  }
  if (row.catalog_item === null) {
    return { ...row, catalog_item: null };
  }
  return {
    ...row,
    catalog_item: toJsonSafeCatalogItem(row.catalog_item),
  };
}

export function mapNestedCatalogItemsForHttp<
  T extends { items?: Array<{ catalog_item?: CatalogItem | null }> },
>(parent: T): T {
  if (!parent.items) {
    return parent;
  }
  return {
    ...parent,
    items: parent.items.map((item) => embedCatalogItemForHttp(item)),
  } as T;
}

export function toCatalogItemResponseDto(
  item: CatalogItem,
): CatalogItemResponseDto {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    cost_price: item.cost_price?.toString() ?? null,
    retail_price: item.retail_price.toString(),
    unit: item.unit,
    brand_id: item.brand_id,
    revenue_group_id: item.revenue_group_id,
    revision: catalogItemRevisionToJsonInteger(item.revision),
  };
}
