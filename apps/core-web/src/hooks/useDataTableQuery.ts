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
}

interface FilterParam {
  field: string
  operator: string
  value: any
}

interface SortParam {
  field: string
  direction: "asc" | "desc"
}

export function useDataTableQuery(options: UseDataTableQueryOptions = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { defaultPageSize = 25, debounceMs = 500 } = options

  // Initial State from URL
  const initialParams = React.useMemo(() => {
    const paramsStr = searchParams.get("params")
    if (!paramsStr) return null
    try {
      return JSON.parse(paramsStr)
    } catch {
      return null
    }
  }, [searchParams])

  // Table State
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    () => {
      if (!initialParams?.filters) return []
      return initialParams.filters.map((f: FilterParam) => ({
        id: f.field,
        value: f.value, // Simplified: assuming 'equals' or handled elsewhere for now. 
                        // Real implementation needs to map operators back to UI state.
                        // For this iteration, we focus on syncing state -> URL.
      }))
    }
  )

  const [sorting, setSorting] = React.useState<SortingState>(() => {
    if (!initialParams?.sorting) return []
    return initialParams.sorting.map((s: SortParam) => ({
      id: s.field,
      desc: s.direction === "desc",
    }))
  })

  const [pagination, setPagination] = React.useState<PaginationState>(() => ({
    pageIndex: (initialParams?.page || 1) - 1,
    pageSize: initialParams?.pageSize || defaultPageSize,
  }))

  // Debounce URL Updates
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      const filters: FilterParam[] = columnFilters.map((filter) => {
          // Complex filter mapping would go here. 
          // For now, assuming standard 'contains' for strings, 'equals' for others could be implicit
          // But the backend expects 'operator'.
          // We'll default to 'contains' for now or need a way to store operator in columnFilters value
          return {
            field: filter.id,
            operator: 'contains', // Defaulting for simplicity in this MVP
            value: filter.value,
          }
      })

      const sortParams: SortParam[] = sorting.map((sort) => ({
        field: sort.id,
        direction: sort.desc ? "desc" : "asc",
      }))

      const queryObj = {
        filters: filters.length > 0 ? filters : undefined,
        sorting: sortParams.length > 0 ? sortParams : undefined,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
      }

      // Only add params if there's something to query
      if (!queryObj.filters && !queryObj.sorting && queryObj.page === 1 && queryObj.pageSize === defaultPageSize) {
          setSearchParams((prev) => {
              const newParams = new URLSearchParams(prev)
              newParams.delete("params")
              return newParams
          })
      } else {
          setSearchParams((prev) => {
              const newParams = new URLSearchParams(prev)
              newParams.set("params", JSON.stringify(queryObj))
              return newParams
          })
      }
    }, debounceMs)

    return () => clearTimeout(timeout)
  }, [columnFilters, sorting, pagination, setSearchParams, defaultPageSize, debounceMs])

  return {
    columnFilters,
    setColumnFilters,
    sorting,
    setSorting,
    pagination,
    setPagination,
    // Helper to get the current query string for API calls
    queryParams: searchParams.get("params") || undefined,
  }
}
