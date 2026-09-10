import * as React from "react"
import { useSearchParams } from "react-router-dom"
import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from '@tanstack/react-table'

interface UseDataTableQueryOptions {
  defaultPageSize?: number
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

function parseUrlTableState(searchParams: URLSearchParams, defaultPageSize: number): ParsedUrlTableState {
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
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : defaultPageSize,
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
    if (
      key === "page" ||
      key === "pageSize" ||
      key === "search" ||
      key === "sortField" ||
      key === "sortDirection" ||
      key.startsWith("filter_")
    ) {
      next.delete(key)
    }
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
  const [searchParams, setSearchParams] = useSearchParams()
  const { defaultPageSize = 25, debounceMs = 500, initialSorting = [] } = options
  const searchParamsKey = searchParams.toString()
  const initialSortingKey = JSON.stringify(initialSorting)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableInitialSorting = React.useMemo<SortingState>(() => initialSorting, [initialSortingKey])

  // Initial State from URL
  const initialParsed = parseUrlTableState(new URLSearchParams(searchParamsKey), defaultPageSize)
  const initialState = convertParsedToTableState(initialParsed, stableInitialSorting)

  // Table State
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(initialState.columnFilters)
  const [sorting, setSorting] = React.useState<SortingState>(initialState.sorting)
  const [pagination, setPagination] = React.useState<PaginationState>(initialState.pagination)
  const [globalFilter, setGlobalFilter] = React.useState<string>(initialState.search)

  // Keep table state in sync when URL query changes from navigation (for saved views/history).
  React.useEffect(() => {
    const nextParsed = parseUrlTableState(new URLSearchParams(searchParamsKey), defaultPageSize)
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
  }, [searchParamsKey, defaultPageSize, stableInitialSorting])

  // Debounce URL Updates
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchParams((prev) =>
        buildUpdatedSearchParams(prev, {
          columnFilters,
          sorting,
          pagination,
          globalFilter,
          defaultPageSize,
        })
      )
    }, debounceMs)

    return () => clearTimeout(timeout)
  }, [columnFilters, sorting, pagination, globalFilter, setSearchParams, defaultPageSize, debounceMs])

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
