import type { VehicleStockQueryService } from './vehicle-stock-query.service.js';

export type VehicleStockListQuery = {
  search?: string;
  stockStatus?: string;
  page?: string;
  limit?: string;
  pageSize?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  pagination?: string;
  cursor?: string;
};

function parseOptionalLimit(
  limit?: string,
  pageSize?: string,
): number | undefined {
  const parsedLimit = limit ? parseInt(limit, 10) : undefined;
  const parsedPageSize = pageSize ? parseInt(pageSize, 10) : undefined;
  return parsedLimit ?? parsedPageSize;
}

function parseSortDirection(
  sortDirection?: 'asc' | 'desc',
): 'asc' | 'desc' | undefined {
  if (sortDirection === 'desc') {
    return 'desc';
  }
  if (sortDirection === 'asc') {
    return 'asc';
  }
  return undefined;
}

export function dispatchVehicleStockList(
  stock: VehicleStockQueryService,
  query: VehicleStockListQuery,
) {
  const parsedLimit = parseOptionalLimit(query.limit, query.pageSize);
  const sortDirection = parseSortDirection(query.sortDirection);
  if (query.pagination === 'cursor' || query.cursor) {
    return stock.listWithCursor({
      search: query.search,
      stock_status: query.stockStatus,
      limit: parsedLimit,
      sortField: query.sortField,
      sortDirection,
      cursor: query.cursor,
    });
  }
  return stock.list({
    search: query.search,
    stock_status: query.stockStatus,
    page: query.page ? parseInt(query.page, 10) : undefined,
    limit: parsedLimit,
    sortField: query.sortField,
    sortDirection,
  });
}
