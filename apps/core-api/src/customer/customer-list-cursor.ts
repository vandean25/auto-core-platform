import {
  GLOBAL_LIST_LIMIT_MAX,
  LIST_CURSOR_ENDPOINT,
  listCursorParamForbiddenException,
  listCursorSortUnsupportedException,
  type KeysetSortDirection,
} from '../common/list-cursor/index.js';

export const CUSTOMER_CURSOR_ENDPOINT = LIST_CURSOR_ENDPOINT.customers;

const CUSTOMER_CURSOR_DEFAULT_LIMIT = 50;

/**
 * Cursor-capable customer sorts (ADR-0035 §3). Only `createdAt` is shipped: `company_name`, `email`,
 * and `address_city` stay offset until real plans justify them.
 */
const CUSTOMER_CURSOR_SORTS = {
  createdAt: { prismaField: 'createdAt', valueKind: 'date', nullable: false },
} as const;

export type CustomerCursorQuery = {
  search?: string;
  type?: 'PRIVATE' | 'COMPANY';
  sortField?: string;
  sortDirection?: KeysetSortDirection;
  limit?: string;
  cursor?: string;
  page?: string;
  pageSize?: string;
};

/** Offset paging parameters never mix into a cursor chain (400 `LIST_CURSOR_PARAM_FORBIDDEN`). */
export function assertNoCustomerOffsetParams(query: CustomerCursorQuery): void {
  for (const param of ['page', 'pageSize'] as const) {
    if (query[param] !== undefined) {
      throw listCursorParamForbiddenException(param);
    }
  }
}

/** Newest first: `createdAt DESC, id DESC` unless the client picks a direction. */
export function resolveCustomerCursorSort(
  sortField?: string,
  sortDirection?: KeysetSortDirection,
) {
  const field = sortField ?? 'createdAt';
  if (!Object.hasOwn(CUSTOMER_CURSOR_SORTS, field)) {
    throw listCursorSortUnsupportedException();
  }
  return {
    field,
    direction: sortDirection ?? 'desc',
    config: CUSTOMER_CURSOR_SORTS[field as keyof typeof CUSTOMER_CURSOR_SORTS],
  };
}

export function resolveCustomerCursorLimit(limit?: string): number {
  const parsed = Number.parseInt(limit ?? '', 10);
  const requested = Number.isFinite(parsed)
    ? parsed
    : CUSTOMER_CURSOR_DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), GLOBAL_LIST_LIMIT_MAX);
}

/** Exactly the filters the resolver applies; any change resets the cursor chain. */
export function customerListFilterContext(query: CustomerCursorQuery) {
  return { search: query.search ?? '', type: query.type ?? '' };
}
