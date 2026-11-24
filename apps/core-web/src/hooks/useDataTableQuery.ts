import * as React from "react"
import { MAX_LIST_PAGE_SIZE, clampPageSize } from "@/lib/list-page-size"
import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from '@tanstack/react-table'
import { useDataTableUrl } from './use-data-table-url'

export const DATA_TABLE_URL_SYNC_DEBOUNCE_MS = 500

interface UseDataTableQueryOptions {
  defaultPageSize?: number
  /** Largest page size the URL may ask for: a hand-edited or old link must not request a page the API refuses. */
  maxPageSize?: number
  debounceMs?: number
  initialSorting?: SortingState
}

export interface FilterParam {
  field: string
  value: string
}

interface SortParam {
  field: string
  direction: "asc" | "desc"
}

export interface DataTableQueryParams {
  page: number
  pageSize: number
  search?: string
  sortField?: string
  sortDirection?: "asc" | "desc"
  filters: FilterParam[]
}

interface ParsedUrlTableState {
  page: number
  pageSize: number
  search: string
  filters: FilterParam[]
  sorting: SortParam[]
}

function parseUrlTableState(
  searchParams: URLSearchParams,
  defaultPageSize: number,
  maxPageSize: number,
): ParsedUrlTableState {
  const page = Number(searchParams.get("page") ?? 1)
  const pageSize = Number(searchParams.get("pageSize") ?? defaultPageSize)
  const search = searchParams.get("search") ?? ""
  const sortField = searchParams.get("sortField")
  const sortDirection = searchParams.get("sortDirection")

  const filters: FilterParam[] = []
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith("filter_")) {
      filters.push({
        field: key.replace("filter_", ""),
        value,
      })
    }
  }

  const sorting: SortParam[] = sortField
    ? [{ field: sortField, direction: sortDirection === "desc" ? "desc" : "asc" }]
    : []

  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? clampPageSize(pageSize, maxPageSize) : defaultPageSize,
    search,
    filters,
    sorting,
  }
}

function areColumnFiltersEqual(left: ColumnFiltersState, right: ColumnFiltersState): boolean {
  if (left.length !== right.length) return false
  return left.every((filter, index) => filter.id === right[index]?.id && String(filter.value) === String(right[index]?.value))
}

function areSortingEqual(left: SortingState, right: SortingState): boolean {
  if (left.length !== right.length) return false
  return left.every((sort, index) => sort.id === right[index]?.id && sort.desc === right[index]?.desc)
}

function convertParsedToTableState(
  parsed: ParsedUrlTableState,
  fallbackSorting: SortingState
) {
  const columnFilters: ColumnFiltersState = parsed.filters.map((filter) => ({
    id: filter.field,
    value: filter.value,
  }))
  const nextSorting: SortingState = parsed.sorting.map((sort) => ({
    id: sort.field,
    desc: sort.direction === "desc",
  }))
  const sorting = nextSorting.length === 0 ? fallbackSorting : nextSorting
  const pagination: PaginationState = {
    pageIndex: parsed.page - 1,
    pageSize: parsed.pageSize,
  }
  return { columnFilters, sorting, pagination, search: parsed.search }
}

const queryParamKeys = new Set(['page', 'pageSize', 'search', 'sortField', 'sortDirection'])

function isQueryParam(key: string): boolean {
  return queryParamKeys.has(key) || key.startsWith('filter_')
}

function buildUpdatedSearchParams(
  prev: URLSearchParams,
  params: {
    columnFilters: ColumnFiltersState
    sorting: SortingState
    pagination: PaginationState
    globalFilter: string
    defaultPageSize: number
  }
): URLSearchParams {
  const next = new URLSearchParams(prev)

  for (const key of Array.from(next.keys())) {
    if (isQueryParam(key)) next.delete(key)
  }

  const page = params.pagination.pageIndex + 1
  if (page > 1) next.set("page", String(page))
  if (params.pagination.pageSize !== params.defaultPageSize) {
    next.set("pageSize", String(params.pagination.pageSize))
  }
  if (params.globalFilter) next.set("search", params.globalFilter)

  const sort = params.sorting[0]
  if (sort) {
    next.set("sortField", sort.id)
    next.set("sortDirection", sort.desc ? "desc" : "asc")
  }

  for (const filter of params.columnFilters) {
    next.set(`filter_${filter.id}`, String(filter.value))
  }

  return next
}

function buildQueryParams(
  pagination: PaginationState,
  sorting: SortingState,
  globalFilter: string,
  columnFilters: ColumnFiltersState
): DataTableQueryParams {
  return {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: globalFilter || undefined,
    sortField: sorting[0]?.id,
    sortDirection: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
    filters: columnFilters.map((filter) => ({
      field: filter.id,
      value: String(filter.value),
    })),
  }
}

export function useDataTableQuery(options: UseDataTableQueryOptions = {}) {
  const { location, searchParams, updateSearch } = useDataTableUrl()
  const {
    defaultPageSize = 25,
    maxPageSize = MAX_LIST_PAGE_SIZE,
    debounceMs = DATA_TABLE_URL_SYNC_DEBOUNCE_MS,
    initialSorting = [],
  } = options
  const querySearch = new URLSearchParams([...searchParams].filter(([key]) => isQueryParam(key)))
  querySearch.sort()
  const searchParamsKey = querySearch.toString()
  const initialSortingKey = JSON.stringify(initialSorting)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableInitialSorting = React.useMemo<SortingState>(() => initialSorting, [initialSortingKey])

  // Initial State from URL
  const initialParsed = parseUrlTableState(new URLSearchParams(searchParamsKey), defaultPageSize, maxPageSize)
  const initialState = convertParsedToTableState(initialParsed, stableInitialSorting)

  // Table State
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(initialState.columnFilters)
  const [sorting, setSorting] = React.useState<SortingState>(initialState.sorting)
  const [pagination, setPagination] = React.useState<PaginationState>(initialState.pagination)
  const [globalFilter, setGlobalFilter] = React.useState<string>(initialState.search)

  // Keep table state in sync when URL query changes from navigation (for saved views/history).
  React.useEffect(() => {
    const nextParsed = parseUrlTableState(new URLSearchParams(searchParamsKey), defaultPageSize, maxPageSize)
    const nextState = convertParsedToTableState(nextParsed, stableInitialSorting)

    setColumnFilters((previous) => (areColumnFiltersEqual(previous, nextState.columnFilters) ? previous : nextState.columnFilters))
    setSorting((previous) => (areSortingEqual(previous, nextState.sorting) ? previous : nextState.sorting))
    setPagination((previous) => {
      if (previous.pageIndex === nextState.pagination.pageIndex && previous.pageSize === nextState.pagination.pageSize) {
        return previous
      }
      return nextState.pagination
    })
    setGlobalFilter((previous) => (previous === nextState.search ? previous : nextState.search))
  }, [location.pathname, searchParamsKey, defaultPageSize, maxPageSize, stableInitialSorting])

  // Debounce URL Updates
  React.useEffect(() => {
    const timeout = setTimeout(() => updateSearch((current) => {
      const next = buildUpdatedSearchParams(current, {
        columnFilters,
        sorting,
        pagination,
        globalFilter,
        defaultPageSize,
      })
      // A URL that already describes the table (only spelt differently, e.g. `page=1`) is tidied in place; a push would
      // leave a duplicate history entry behind.
      const shown = convertParsedToTableState(parseUrlTableState(current, defaultPageSize, maxPageSize), stableInitialSorting)
      const tidiesUrlOnly =
        areColumnFiltersEqual(shown.columnFilters, columnFilters) &&
        areSortingEqual(shown.sorting, sorting) &&
        shown.pagination.pageIndex === pagination.pageIndex &&
        shown.pagination.pageSize === pagination.pageSize &&
        shown.search === globalFilter
      return { next, replace: tidiesUrlOnly }
    }), debounceMs)

    return () => clearTimeout(timeout)
  }, [columnFilters, sorting, pagination, globalFilter, updateSearch, location.pathname, searchParamsKey, defaultPageSize, maxPageSize, debounceMs, stableInitialSorting])

  return {
    columnFilters,
    setColumnFilters,
    sorting,
    setSorting,
    pagination,
    setPagination,
    globalFilter,
    setGlobalFilter,
    queryParams: buildQueryParams(pagination, sorting, globalFilter, columnFilters),
  }
}
