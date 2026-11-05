import {
  LIST_CURSOR_ENDPOINT,
  listCursorSortUnsupportedException,
  type KeysetSortDirection,
} from '../common/list-cursor/index.js';

export type VehicleStockCursorSortField =
  'make' | 'model' | 'year' | 'vin' | 'plate' | 'color' | 'updatedAt';

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
  const defaultField: VehicleStockCursorSortField = 'updatedAt';
  const field = sortField ?? defaultField;
  if (!Object.hasOwn(VEHICLE_STOCK_CURSOR_SORTS, field)) {
    throw listCursorSortUnsupportedException();
  }
  const config = VEHICLE_STOCK_CURSOR_SORTS[field as VehicleStockCursorSortField];
  return {
    field: field as VehicleStockCursorSortField,
    direction: sortDirection ?? (field === 'updatedAt' ? 'desc' : 'asc'),
    config,
  };
}
