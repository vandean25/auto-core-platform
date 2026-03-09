import * as React from "react"
import { useSearchParams } from "react-router-dom"
import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table"

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

export function useDataTableQuery(options: UseDataTableQueryOptions = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { defaultPageSize = 25, debounceMs = 500, initialSorting = [] } = options
  const searchParamsKey = searchParams.toString()
  const initialSortingKey = JSON.stringify(initialSorting)
  const stableInitialSorting = React.useMemo<SortingState>(() => initialSorting, [initialSortingKey])

  // Initial State from URL
  const initialParams = React.useMemo(
    () => parseUrlTableState(new URLSearchParams(searchParamsKey), defaultPageSize),
    [searchParamsKey, defaultPageSize],
  )

  // Table State
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(() => {
    if (!initialParams?.filters) return []
    return initialParams.filters.map((f: FilterParam) => ({
      id: f.field,
      value: f.value,
    }))
  })

  const [sorting, setSorting] = React.useState<SortingState>(() => {
    if (!initialParams?.sorting) return stableInitialSorting
    return initialParams.sorting.map((s: SortParam) => ({
      id: s.field,
      desc: s.direction === "desc",
    }))
  })

  const [pagination, setPagination] = React.useState<PaginationState>(() => ({
    pageIndex: (initialParams?.page || 1) - 1,
    pageSize: initialParams?.pageSize || defaultPageSize,
  }))

  const [globalFilter, setGlobalFilter] = React.useState<string>(() => initialParams?.search || "")

  // Keep table state in sync when URL query changes from navigation (for saved views/history).
  React.useEffect(() => {
    const next = parseUrlTableState(new URLSearchParams(searchParamsKey), defaultPageSize)
    const nextColumnFilters: ColumnFiltersState = next.filters.map((filter) => ({
      id: filter.field,
      value: filter.value,
    }))
    const nextSorting: SortingState = next.sorting.map((sort) => ({
      id: sort.field,
      desc: sort.direction === "desc",
    }))
    const fallbackSorting = nextSorting.length === 0 ? stableInitialSorting : nextSorting

    setColumnFilters((previous) => (areColumnFiltersEqual(previous, nextColumnFilters) ? previous : nextColumnFilters))
    setSorting((previous) => (areSortingEqual(previous, fallbackSorting) ? previous : fallbackSorting))
    setPagination((previous) => {
      if (previous.pageIndex === next.page - 1 && previous.pageSize === next.pageSize) {
        return previous
      }
      return {
        pageIndex: next.page - 1,
        pageSize: next.pageSize,
      }
    })
    setGlobalFilter((previous) => (previous === next.search ? previous : next.search))
  }, [searchParamsKey, defaultPageSize, stableInitialSorting, setColumnFilters, setSorting, setPagination, setGlobalFilter])

  // Debounce URL Updates
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      const filters: FilterParam[] = columnFilters.map((filter) => ({
        field: filter.id,
        value: String(filter.value),
      }))

      const sortParams: SortParam[] = sorting.map((sort) => ({
        field: sort.id,
        direction: sort.desc ? "desc" : "asc",
      }))

      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)

        // clear table-related params first
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

        const page = pagination.pageIndex + 1
        if (page > 1) next.set("page", String(page))
        if (pagination.pageSize !== defaultPageSize) next.set("pageSize", String(pagination.pageSize))
        if (globalFilter) next.set("search", globalFilter)
        if (sortParams[0]) {
          next.set("sortField", sortParams[0].field)
          next.set("sortDirection", sortParams[0].direction)
        }
        for (const filter of filters) {
          next.set(`filter_${filter.field}`, String(filter.value))
        }
        return next
      })
    }, debounceMs)

    return () => clearTimeout(timeout)
  }, [columnFilters, sorting, pagination, globalFilter, setSearchParams, defaultPageSize, debounceMs])

  const queryFilters: FilterParam[] = React.useMemo(
    () =>
      columnFilters.map((filter) => ({
        field: filter.id,
        value: String(filter.value),
      })),
    [columnFilters],
  )

  return {
    columnFilters,
    setColumnFilters,
    sorting,
    setSorting,
    pagination,
    setPagination,
    globalFilter,
    setGlobalFilter,
    queryParams: {
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      search: globalFilter || undefined,
      sortField: sorting[0]?.id,
      sortDirection: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
      filters: queryFilters,
    } satisfies DataTableQueryParams,
  }
}
