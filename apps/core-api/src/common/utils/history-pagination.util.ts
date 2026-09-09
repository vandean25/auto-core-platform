export const DEFAULT_HISTORY_LIMIT = 20;
export const MAX_HISTORY_LIMIT = 100;

export interface HistoryPaginationOptions {
  page?: number;
  limit?: number;
}

export interface HistoryPagination {
  page: number;
  limit: number;
  skip: number;
}

export interface HistoryMeta {
  page: number;
  pageSize: number;
  totalCount: number;
  pageCount: number;
  hasMore: boolean;
}

export function resolveHistoryPagination(
  options?: HistoryPaginationOptions,
): HistoryPagination {
  const page = options?.page && options.page > 0 ? options.page : 1;
  const requestedLimit =
    options?.limit && options.limit > 0 ? options.limit : DEFAULT_HISTORY_LIMIT;
  const limit = Math.min(requestedLimit, MAX_HISTORY_LIMIT);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

export function buildHistoryMeta(
  pagination: HistoryPagination,
  totalCount: number,
): HistoryMeta {
  const pageCount = Math.ceil(totalCount / pagination.limit);

  return {
    page: pagination.page,
    pageSize: pagination.limit,
    totalCount,
    pageCount,
    hasMore: pagination.page < (pageCount === 0 ? 1 : pageCount),
  };
}
