import {
  LIST_CURSOR_ENDPOINT,
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
  const field = (sortField ?? 'sku') as InventoryCursorSortField;
  const config = INVENTORY_CURSOR_SORTS[field];
  if (!config) {
    throw new Error(
      `Sort field ${sortField ?? ''} is not cursor-enabled for inventory`,
    );
  }
  return {
    field,
    direction: sortDirection ?? 'asc',
    config,
  };
}
