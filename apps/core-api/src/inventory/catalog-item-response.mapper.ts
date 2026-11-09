import type { CatalogItem } from '@prisma/client';
import type { CatalogItemResponseDto } from './dto/inventory-response.dto.js';
import { catalogItemRevisionToJsonInteger } from './catalog-item-revision-json.util.js';

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
