import {
  LIST_CURSOR_ENDPOINT,
  listCursorSortUnsupportedException,
  type KeysetSortDirection,
} from '../common/list-cursor/index.js';

export type InventoryCursorSortField = 'sku' | 'name' | 'price';

const INVENTORY_CURSOR_SORTS: Record<
  InventoryCursorSortField,
  { prismaField: string; valueKind: 'string' | 'decimal'; nullable: boolean }
> = {
  sku: { prismaField: 'sku', valueKind: 'string', nullable: false },
  name: { prismaField: 'name', valueKind: 'string', nullable: false },
  price: { prismaField: 'retail_price', valueKind: 'decimal', nullable: false },
};

export const INVENTORY_CURSOR_ENDPOINT = LIST_CURSOR_ENDPOINT.inventory;

export function resolveInventoryCursorSort(
  sortField?: string,
  sortDirection?: KeysetSortDirection,
): {
  field: InventoryCursorSortField;
  direction: KeysetSortDirection;
  config: (typeof INVENTORY_CURSOR_SORTS)[InventoryCursorSortField];
} {
  const defaultField: InventoryCursorSortField = 'sku';
  const field = sortField ?? defaultField;
  if (!Object.hasOwn(INVENTORY_CURSOR_SORTS, field)) {
    throw listCursorSortUnsupportedException();
  }
  const config = INVENTORY_CURSOR_SORTS[field as InventoryCursorSortField];
  return {
    field: field as InventoryCursorSortField,
    direction: sortDirection ?? 'asc',
    config,
  };
}
