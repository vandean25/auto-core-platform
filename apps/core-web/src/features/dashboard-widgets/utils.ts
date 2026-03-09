import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'

export function getValueByPath(record: unknown, path: string): unknown {
  if (!record || typeof record !== 'object') return undefined
  const segments = path.split('.')
  let current: unknown = record
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function stringifyValue(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map((entry) => stringifyValue(entry)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function parseDataTableQueryParams(searchParams: URLSearchParams): DataTableQueryParams {
  const filters: Array<{ field: string; value: string }> = []
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith('filter_')) {
      filters.push({
        field: key.replace('filter_', ''),
        value,
      })
    }
  }

  const page = Number(searchParams.get('page') ?? 1)
  const pageSize = Number(searchParams.get('pageSize') ?? 200)

  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 200,
    search: searchParams.get('search') ?? undefined,
    sortField: searchParams.get('sortField') ?? undefined,
    sortDirection:
      searchParams.get('sortDirection') === 'desc'
        ? 'desc'
        : searchParams.get('sortDirection') === 'asc'
          ? 'asc'
          : undefined,
    filters,
  }
}

export function applyClientFiltersAndSort(rows: unknown[], queryParams: DataTableQueryParams): unknown[] {
  const normalizedSearch = queryParams.search?.trim().toLowerCase()
  const normalizedFilters = queryParams.filters.map((filter) => ({
    ...filter,
    value: filter.value.trim().toLowerCase(),
  }))

  let filtered = rows.filter((row) => {
    if (normalizedSearch) {
      const text = stringifyValue(row).toLowerCase()
      if (!text.includes(normalizedSearch)) {
        return false
      }
    }

    for (const filter of normalizedFilters) {
      const value = stringifyValue(getValueByPath(row, filter.field)).toLowerCase()
      if (!value.includes(filter.value)) {
        return false
      }
    }

    return true
  })

  if (queryParams.sortField) {
    const sortField = queryParams.sortField
    const direction = queryParams.sortDirection === 'desc' ? -1 : 1
    filtered = [...filtered].sort((left, right) => {
      const leftValue = getValueByPath(left, sortField)
      const rightValue = getValueByPath(right, sortField)
      const leftNumber = Number(leftValue)
      const rightNumber = Number(rightValue)
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return (leftNumber - rightNumber) * direction
      }
      return stringifyValue(leftValue).localeCompare(stringifyValue(rightValue)) * direction
    })
  }

  return filtered
}

