import { QueryBuilder, type QueryParams } from '../common/utils/query-builder';
import type { Prisma } from '@prisma/client';
import type { FindPurchaseOrdersQueryDto } from './dto/find-purchase-orders-query.dto';
import type { PaginatedPurchaseOrderResult } from './purchase.service';

const SORT_WHITELIST = [
  'order_number',
  'status',
  'vendor.name',
  'total_amount',
  'createdAt',
  'created_at',
  'expected_date',
] as const;

const SEARCH_FIELDS = ['order_number', 'vendor.name'] as const;

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;

export interface PurchaseOrderPaginatedResponse {
  data: PaginatedPurchaseOrderResult['data'];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
}

export class PurchaseOrderQueryBuilder {
  static usesAdvancedQuery(query: FindPurchaseOrdersQueryDto): boolean {
    return Object.keys(this.toQueryParams(query)).length > 0;
  }

  static toLegacyStatus(query: FindPurchaseOrdersQueryDto): string | undefined {
    return query.status;
  }

  static toPrismaQuery(
    query: FindPurchaseOrdersQueryDto,
  ): Prisma.PurchaseOrderFindManyArgs {
    const queryParams = this.toQueryParams(query);
    return QueryBuilder.buildPrismaQuery(
      queryParams,
      [...SORT_WHITELIST],
      [...SEARCH_FIELDS],
    );
  }

  static toPaginatedResponse(
    result: PaginatedPurchaseOrderResult,
    query: FindPurchaseOrdersQueryDto,
  ): PurchaseOrderPaginatedResponse {
    const queryParams = this.toQueryParams(query);
    const page = queryParams.page ?? DEFAULT_PAGE;
    const pageSize = queryParams.pageSize ?? DEFAULT_PAGE_SIZE;

    return {
      data: result.data,
      meta: {
        total: result.total,
        page,
        pageSize,
        pageCount: Math.ceil(result.total / pageSize),
      },
    };
  }

  static toLegacyPaginatedResponse(
    result: PaginatedPurchaseOrderResult,
  ): PurchaseOrderPaginatedResponse {
    const pageSize = result.data.length || 1;

    return {
      data: result.data,
      meta: {
        total: result.total,
        page: 1,
        pageSize,
        pageCount: 1,
      },
    };
  }

  private static toQueryParams(query: FindPurchaseOrdersQueryDto): QueryParams {
    const queryParams: QueryParams = {};

    if (query.search) {
      queryParams.search = query.search;
    }
    if (query.page) {
      queryParams.page = query.page;
    }
    if (query.pageSize) {
      queryParams.pageSize = query.pageSize;
    }
    if (query.sortField) {
      queryParams.sorting = [
        {
          field: query.sortField,
          direction: query.sortDirection ?? 'asc',
        },
      ];
    }
    if (query.status && query.status !== 'open' && query.status !== 'all') {
      queryParams.filters = [
        { field: 'status', operator: 'equals', value: query.status },
      ];
    }

    return queryParams;
  }
}
