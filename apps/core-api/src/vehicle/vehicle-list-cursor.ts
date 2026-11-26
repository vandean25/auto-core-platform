import {
  GLOBAL_LIST_LIMIT_MAX,
  LIST_CURSOR_ENDPOINT,
  listCursorParamForbiddenException,
  listCursorSortUnsupportedException,
  type KeysetSortDirection,
} from '../common/list-cursor/index.js';

export const VEHICLE_CURSOR_ENDPOINT = LIST_CURSOR_ENDPOINT.vehicles;

const VEHICLE_CURSOR_DEFAULT_LIMIT = 50;

/**
 * Cursor-capable customer vehicle sorts (ADR-0035 §3). Only `createdAt` is shipped: `make`, `model`,
 * `year`, `plate`, `vin`, and the relation sort `customer` stay offset until real plans justify them.
 */
const VEHICLE_CURSOR_SORTS = {
  createdAt: { prismaField: 'createdAt', valueKind: 'date', nullable: false },
} as const;

export type VehicleCursorQuery = {
  search?: string;
  sortField?: string;
  sortDirection?: KeysetSortDirection;
  limit?: string;
  cursor?: string;
  page?: string;
  pageSize?: string;
};

/** Offset paging parameters never mix into a cursor chain (400 `LIST_CURSOR_PARAM_FORBIDDEN`). */
export function assertNoVehicleOffsetParams(query: VehicleCursorQuery): void {
  for (const param of ['page', 'pageSize'] as const) {
    if (query[param] !== undefined) {
      throw listCursorParamForbiddenException(param);
    }
  }
}

/** Newest first: `createdAt DESC, id DESC` unless the client picks a direction. */
export function resolveVehicleCursorSort(
  sortField?: string,
  sortDirection?: KeysetSortDirection,
) {
  const field = sortField ?? 'createdAt';
  if (!Object.hasOwn(VEHICLE_CURSOR_SORTS, field)) {
    throw listCursorSortUnsupportedException();
  }
  return {
    field,
    direction: sortDirection ?? 'desc',
    config: VEHICLE_CURSOR_SORTS[field as keyof typeof VEHICLE_CURSOR_SORTS],
  };
}

export function resolveVehicleCursorLimit(limit?: string): number {
  const parsed = Number.parseInt(limit ?? '', 10);
  const requested = Number.isFinite(parsed)
    ? parsed
    : VEHICLE_CURSOR_DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), GLOBAL_LIST_LIMIT_MAX);
}

/** Exactly the filters the resolver applies; any change resets the cursor chain. */
export function vehicleListFilterContext(query: VehicleCursorQuery) {
  return { search: query.search ?? '' };
}
