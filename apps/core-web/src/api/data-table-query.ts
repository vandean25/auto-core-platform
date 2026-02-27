import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'

interface BuildDataTableUrlOptions {
  sortFieldMap?: Record<string, string>
  searchFallbackFilterFields?: string[]
  exactFilterMap?: Record<string, string>
}

export function buildDataTableUrl(
  baseUrl: string,
  queryParams?: DataTableQueryParams,
  options: BuildDataTableUrlOptions = {},
) {
  if (!queryParams) return baseUrl

  const params = new URLSearchParams()
  params.append('page', String(queryParams.page))
  params.append('pageSize', String(queryParams.pageSize))

  if (queryParams.sortDirection) {
    params.append('sortDirection', queryParams.sortDirection)
  }
  if (queryParams.sortField) {
    const mappedSortField =
      options.sortFieldMap?.[queryParams.sortField] ?? queryParams.sortField
    params.append('sortField', mappedSortField)
  }

  const searchFallback = options.searchFallbackFilterFields
    ?.map((field) => queryParams.filters.find((f) => f.field === field)?.value)
    .find(Boolean)
  const search =
    typeof queryParams.search === 'string' && queryParams.search.trim() !== ''
      ? queryParams.search
      : searchFallback
  if (search) {
    params.append('search', search)
  }

  if (options.exactFilterMap) {
    for (const [field, queryName] of Object.entries(options.exactFilterMap)) {
      const value = queryParams.filters.find((f) => f.field === field)?.value
      if (value) {
        params.append(queryName, value)
      }
    }
  }

  return `${baseUrl}?${params.toString()}`
}
