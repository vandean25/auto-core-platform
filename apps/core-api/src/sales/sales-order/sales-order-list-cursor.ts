import { BadRequestException } from '@nestjs/common';
import { SalesOrderStatus, type Prisma } from '@prisma/client';
import {
  GLOBAL_LIST_LIMIT_MAX,
  LIST_CURSOR_ENDPOINT,
  LIST_PARAMS_UNSUPPORTED_CODE,
  LIST_STATUS_INVALID_CODE,
  listCursorParamForbiddenException,
  listCursorSortUnsupportedException,
  type CursorSortConfig,
  type KeysetSortDirection,
} from '../../common/list-cursor/index.js';

export const SALES_ORDER_CURSOR_ENDPOINT = LIST_CURSOR_ENDPOINT.salesOrders;

const SALES_ORDER_CURSOR_DEFAULT_LIMIT = 25;

export type SalesOrderCursorSortField = 'createdAt' | 'order_number';

const SALES_ORDER_CURSOR_SORTS: Record<
  SalesOrderCursorSortField,
  CursorSortConfig
> = {
  createdAt: {
    prismaField: 'createdAt',
    valueKind: 'date',
    nullable: false,
  },
  order_number: {
    prismaField: 'order_number',
    valueKind: 'string',
    nullable: false,
  },
};

const VALID_SALES_ORDER_STATUSES = new Set<string>(
  Object.values(SalesOrderStatus),
);

const ALLOWED_PARAMS_KEYS = new Set([
  'filters',
  'sorting',
  'search',
  'page',
  'pageSize',
]);

export type SalesOrderCursorQuery = {
  status?: string;
  params?: string;
  page?: string;
  pageSize?: string;
  search?: string;
  sortField?: string;
  sortDirection?: string;
  limit?: string;
  cursor?: string;
};

export type ResolvedSalesOrderCursorRequest = {
  status?: SalesOrderStatus;
  search?: string;
  sort: {
    field: SalesOrderCursorSortField;
    direction: KeysetSortDirection;
    config: CursorSortConfig;
  };
  limit: number;
  cursor?: string;
};

function listParamsUnsupportedException(): BadRequestException {
  return new BadRequestException({
    code: LIST_PARAMS_UNSUPPORTED_CODE,
    message:
      'These filter or sort parameters are not supported in cursor pagination mode.',
  });
}

function listStatusInvalidException(): BadRequestException {
  return new BadRequestException({
    code: LIST_STATUS_INVALID_CODE,
    message: 'The status filter value is not a valid sales order status.',
  });
}

export function resolveSalesOrderCursorSort(
  sortField?: string,
  sortDirection?: string,
): ResolvedSalesOrderCursorRequest['sort'] {
  if (
    sortDirection !== undefined &&
    sortDirection !== 'asc' &&
    sortDirection !== 'desc'
  ) {
    throw listCursorSortUnsupportedException();
  }
  if (sortField === undefined) {
    if (sortDirection !== undefined) {
      throw listCursorSortUnsupportedException();
    }
    return {
      field: 'createdAt',
      direction: 'desc',
      config: SALES_ORDER_CURSOR_SORTS.createdAt,
    };
  }
  if (!Object.hasOwn(SALES_ORDER_CURSOR_SORTS, sortField)) {
    throw listCursorSortUnsupportedException();
  }
  const field = sortField as SalesOrderCursorSortField;
  return {
    field,
    direction: sortDirection ?? 'asc',
    config: SALES_ORDER_CURSOR_SORTS[field],
  };
}

export function resolveSalesOrderCursorLimit(limit?: string): number {
  const parsed = Number.parseInt(limit ?? '', 10);
  const requested = Number.isFinite(parsed)
    ? parsed
    : SALES_ORDER_CURSOR_DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), GLOBAL_LIST_LIMIT_MAX);
}

function parseRawParamsObject(rawParams: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawParams);
  } catch {
    throw listParamsUnsupportedException();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw listParamsUnsupportedException();
  }
  return parsed as Record<string, unknown>;
}

function assertParamsKeysAllowed(parsed: Record<string, unknown>): void {
  for (const key of Object.keys(parsed)) {
    if ((key === 'page' || key === 'pageSize') && parsed[key] !== undefined) {
      throw listCursorParamForbiddenException(`params.${key}`);
    }
    if (!ALLOWED_PARAMS_KEYS.has(key)) {
      throw listParamsUnsupportedException();
    }
  }
}

function assertArrayParamComponent(
  value: unknown,
  hasFlatOverride: boolean,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw listParamsUnsupportedException();
  }
  if (!hasFlatOverride && value.length > 0) {
    throw listParamsUnsupportedException();
  }
}

function assertSearchParamComponent(
  value: unknown,
  hasFlatOverride: boolean,
): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !hasFlatOverride) {
    throw listParamsUnsupportedException();
  }
}

function validateCursorParamsJson(
  rawParams: string,
  overrides: { hasStatus: boolean; hasSearch: boolean; hasSortField: boolean },
): void {
  const parsed = parseRawParamsObject(rawParams);
  assertParamsKeysAllowed(parsed);
  assertArrayParamComponent(parsed.filters, overrides.hasStatus);
  assertSearchParamComponent(parsed.search, overrides.hasSearch);
  assertArrayParamComponent(parsed.sorting, overrides.hasSortField);
}

/**
 * Single pure resolver for Sales Orders cursor list and capped count.
 * Legacy status override is applied before checking remaining effective `params`.
 */
export function resolveSalesOrderCursorRequest(
  query: SalesOrderCursorQuery,
): ResolvedSalesOrderCursorRequest {
  if (query.page !== undefined) {
    throw listCursorParamForbiddenException('page');
  }
  if (query.pageSize !== undefined) {
    throw listCursorParamForbiddenException('pageSize');
  }

  const hasStatus = query.status !== undefined && query.status !== '';
  const hasSearch = query.search !== undefined && query.search !== '';
  const hasSortField = query.sortField !== undefined && query.sortField !== '';

  if (query.params !== undefined && query.params !== '') {
    validateCursorParamsJson(query.params, {
      hasStatus,
      hasSearch,
      hasSortField,
    });
  }

  let status: SalesOrderStatus | undefined;
  if (query.status !== undefined) {
    if (!VALID_SALES_ORDER_STATUSES.has(query.status)) {
      throw listStatusInvalidException();
    }
    status = query.status as SalesOrderStatus;
  }

  const sort = resolveSalesOrderCursorSort(
    query.sortField,
    query.sortDirection,
  );

  return {
    status,
    search: hasSearch ? query.search : undefined,
    sort,
    limit: resolveSalesOrderCursorLimit(query.limit),
    cursor: query.cursor,
  };
}

export function salesOrderListFilterContext(
  resolved: Pick<ResolvedSalesOrderCursorRequest, 'search' | 'status'>,
) {
  return {
    search: resolved.search ?? '',
    status: resolved.status ?? '',
  };
}

export function buildSalesOrderListWhere(
  tenantId: string,
  siteId: string,
  resolved: Pick<ResolvedSalesOrderCursorRequest, 'search' | 'status'>,
): Prisma.SalesOrderWhereInput {
  const where: Prisma.SalesOrderWhereInput = {
    tenant_id: tenantId,
    site_id: siteId,
  };
  if (resolved.status) {
    where.status = resolved.status;
  }
  if (resolved.search) {
    where.OR = [
      { order_number: { contains: resolved.search, mode: 'insensitive' } },
      {
        customer: {
          last_name: { contains: resolved.search, mode: 'insensitive' },
        },
      },
      {
        customer: {
          company_name: { contains: resolved.search, mode: 'insensitive' },
        },
      },
    ];
  }
  return where;
}
