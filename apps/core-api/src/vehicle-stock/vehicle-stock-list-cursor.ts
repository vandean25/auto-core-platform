import {
  LIST_CURSOR_ENDPOINT,
  type KeysetSortDirection,
} from '../common/list-cursor/index.js';

export type VehicleStockCursorSortField =
  | 'make'
  | 'model'
  | 'year'
  | 'vin'
  | 'plate'
  | 'color'
  | 'stock_status'
  | 'updatedAt';

const VEHICLE_STOCK_CURSOR_SORTS: Record<
  VehicleStockCursorSortField,
  {
    prismaField: string;
    valueKind: 'string' | 'int' | 'date' | 'enum';
    nullable: boolean;
  }
> = {
  make: { prismaField: 'make', valueKind: 'string', nullable: false },
  model: { prismaField: 'model', valueKind: 'string', nullable: false },
  year: { prismaField: 'year', valueKind: 'int', nullable: false },
  vin: { prismaField: 'vin', valueKind: 'string', nullable: true },
  plate: { prismaField: 'plate', valueKind: 'string', nullable: true },
  color: { prismaField: 'color', valueKind: 'string', nullable: true },
  stock_status: {
    prismaField: 'stock_status',
    valueKind: 'enum',
    nullable: true,
  },
  updatedAt: { prismaField: 'updatedAt', valueKind: 'date', nullable: false },
};

export const VEHICLE_STOCK_CURSOR_ENDPOINT = LIST_CURSOR_ENDPOINT.vehicleStock;

export function resolveVehicleStockCursorSort(
  sortField?: string,
  sortDirection?: KeysetSortDirection,
): {
  field: VehicleStockCursorSortField;
  direction: KeysetSortDirection;
  config: (typeof VEHICLE_STOCK_CURSOR_SORTS)[VehicleStockCursorSortField];
} {
  const field = (sortField ?? 'updatedAt') as VehicleStockCursorSortField;
  const config = VEHICLE_STOCK_CURSOR_SORTS[field];
  if (!config) {
    throw new Error(
      `Sort field ${sortField ?? ''} is not cursor-enabled for vehicle stock`,
    );
  }
  return {
    field,
    direction: sortDirection ?? (field === 'updatedAt' ? 'desc' : 'asc'),
    config,
  };
}

export function vehicleStockCursorSortWhitelist(): readonly VehicleStockCursorSortField[] {
  return Object.keys(
    VEHICLE_STOCK_CURSOR_SORTS,
  ) as VehicleStockCursorSortField[];
}

export function vehicleStockCursorSortConfig(
  field: VehicleStockCursorSortField,
) {
  return VEHICLE_STOCK_CURSOR_SORTS[field];
}
