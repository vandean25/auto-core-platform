import {
  GLOBAL_LIST_LIMIT_MAX,
  LIST_CURSOR_ENDPOINT,
  listCursorParamForbiddenException,
  listCursorSortUnsupportedException,
  type KeysetSortDirection,
} from '../common/list-cursor/index.js';

export const WORKSHOP_ORDER_CURSOR_ENDPOINT =
  LIST_CURSOR_ENDPOINT.workshopOrders;

/** Block size of the infinite list; the ceiling is the global list ceiling. */
const WORKSHOP_ORDER_CURSOR_DEFAULT_LIMIT = 50;

/**
 * Cursor-capable workshop order sorts (ADR-0035 §3). Only `createdAt` is shipped: `order_number` and `status`
 * stay offset until real plans justify them, and the relation sorts `customer` and `vehicle` stay offset.
 */
const WORKSHOP_ORDER_CURSOR_SORTS = {
  createdAt: { prismaField: 'createdAt', valueKind: 'date', nullable: false },
} as const;

export type WorkshopOrderCursorQuery = {
  search?: string;
  customerId?: string;
  sortField?: string;
  sortDirection?: KeysetSortDirection;
  limit?: string;
  cursor?: string;
  page?: string;
  pageSize?: string;
};

/** Offset paging parameters never mix into a cursor chain (400 `LIST_CURSOR_PARAM_FORBIDDEN`). */
export function assertNoOffsetParams(query: WorkshopOrderCursorQuery): void {
  for (const param of ['page', 'pageSize'] as const) {
    if (query[param] !== undefined) {
      throw listCursorParamForbiddenException(param);
    }
  }
}

/** Newest first: `createdAt DESC, id DESC` unless the client picks a direction. */
export function resolveWorkshopOrderCursorSort(
  sortField?: string,
  sortDirection?: KeysetSortDirection,
) {
  const field = sortField ?? 'createdAt';
  if (!Object.hasOwn(WORKSHOP_ORDER_CURSOR_SORTS, field)) {
    throw listCursorSortUnsupportedException();
  }
  return {
    field,
    direction: sortDirection ?? 'desc',
    config:
      WORKSHOP_ORDER_CURSOR_SORTS[
        field as keyof typeof WORKSHOP_ORDER_CURSOR_SORTS
      ],
  };
}

export function resolveWorkshopOrderCursorLimit(limit?: string): number {
  const parsed = Number.parseInt(limit ?? '', 10);
  const requested = Number.isFinite(parsed)
    ? parsed
    : WORKSHOP_ORDER_CURSOR_DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), GLOBAL_LIST_LIMIT_MAX);
}

/** Exactly the filters the resolver applies; any change resets the cursor chain. */
export function workshopOrderListFilterContext(
  query: WorkshopOrderCursorQuery,
) {
  return { search: query.search ?? '', customerId: query.customerId ?? '' };
}
