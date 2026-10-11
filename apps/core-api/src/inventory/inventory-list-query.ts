import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';

// Catalog columns the inventory list can be ordered by in the database. Derived
// columns such as status and storage location are intentionally not sortable.
const INVENTORY_SORT_FIELDS = ['sku', 'name', 'price'] as const;

export function parsePositiveInt(
  value: string | undefined,
  fallback?: number,
): number | undefined {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseSortDirection(value?: string): 'asc' | 'desc' | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined;
}

export function buildInventoryOrderBy(
  sortField?: string,
  sortDirection: 'asc' | 'desc' = 'asc',
): Prisma.CatalogItemOrderByWithRelationInput[] | undefined {
  switch (sortField) {
    case 'sku':
      return [{ sku: sortDirection }, { id: 'asc' }];
    case 'name':
      return [{ name: sortDirection }, { id: 'asc' }];
    case 'price':
      return [{ retail_price: sortDirection }, { id: 'asc' }];
    default:
      return undefined;
  }
}

export function ApiInventorySort() {
  return applyDecorators(
    ApiQuery({
      name: 'sortField',
      required: false,
      schema: { type: 'string', enum: [...INVENTORY_SORT_FIELDS] },
    }),
    ApiQuery({
      name: 'sortDirection',
      required: false,
      schema: { type: 'string', enum: ['asc', 'desc'] },
    }),
  );
}
