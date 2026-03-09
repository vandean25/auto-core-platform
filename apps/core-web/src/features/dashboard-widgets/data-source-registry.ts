import { buildDataTableUrl } from '@/api/data-table-query'
import { fetchWithAuth } from '@/api/client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { applyClientFiltersAndSort, parseDataTableQueryParams } from '@/features/dashboard-widgets/utils'

type WidgetSourceDefinition = {
  key: string
  pathPrefix: string
  buildApiUrl: (queryParams: DataTableQueryParams) => string
}

const widgetSourceDefinitions: WidgetSourceDefinition[] = [
  {
    key: 'workshop-orders',
    pathPrefix: '/workshop/orders',
    buildApiUrl: (queryParams) =>
      buildDataTableUrl('/api/workshop/orders', queryParams, {
        searchFallbackFilterFields: [
          'order_number',
          'id',
          'customer.first_name',
          'customer.last_name',
          'vehicle.make',
          'vehicle.model',
          'vehicle.plate',
        ],
      }),
  },
  {
    key: 'purchase-bills',
    pathPrefix: '/purchase-bills',
    buildApiUrl: (queryParams) => {
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('pageSize', String(Math.max(200, queryParams.pageSize)))
      if (queryParams.sortField) params.set('sortBy', queryParams.sortField)
      if (queryParams.sortDirection) params.set('order', queryParams.sortDirection)
      const status = queryParams.filters.find((filter) => filter.field === 'status')?.value
      if (status) params.set('status', status)
      if (queryParams.search) params.set('search', queryParams.search)
      return `/api/purchase-invoices?${params.toString()}`
    },
  },
  {
    key: 'purchase-orders',
    pathPrefix: '/purchase-orders',
    buildApiUrl: (queryParams) =>
      buildDataTableUrl('/api/purchase-orders', queryParams, {
        searchFallbackFilterFields: ['order_number', 'vendor.name'],
      }),
  },
  {
    key: 'sales-orders',
    pathPrefix: '/sales-orders',
    buildApiUrl: (queryParams) =>
      buildDataTableUrl('/api/sales-orders', queryParams, {
        searchFallbackFilterFields: ['order_number', 'customer.last_name', 'customer.company_name'],
      }),
  },
  {
    key: 'inventory',
    pathPrefix: '/inventory',
    buildApiUrl: (queryParams) => {
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('pageSize', String(Math.max(200, queryParams.pageSize)))
      const nameFilter = queryParams.filters.find((filter) => filter.field === 'name')?.value
      const effectiveSearch = queryParams.search ?? nameFilter
      if (effectiveSearch) params.set('search', effectiveSearch)
      const brandFilter = queryParams.filters.find((filter) => filter.field === 'brand')?.value
      if (brandFilter) params.set('brand', brandFilter)
      return `/api/inventory?${params.toString()}`
    },
  },
  {
    key: 'customers',
    pathPrefix: '/customers',
    buildApiUrl: (queryParams) => {
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('pageSize', String(Math.max(200, queryParams.pageSize)))
      if (queryParams.search) params.set('search', queryParams.search)
      if (queryParams.sortField) params.set('sortField', queryParams.sortField)
      if (queryParams.sortDirection) params.set('sortDirection', queryParams.sortDirection)
      const typeFilter = queryParams.filters.find((filter) => filter.field === 'type')?.value
      if (typeFilter) params.set('type', typeFilter)
      return `/api/customers?${params.toString()}`
    },
  },
  {
    key: 'vendors',
    pathPrefix: '/vendors',
    buildApiUrl: (queryParams) =>
      buildDataTableUrl('/api/vendors', queryParams, {
        searchFallbackFilterFields: ['name'],
      }),
  },
  {
    key: 'vehicles',
    pathPrefix: '/vehicles',
    buildApiUrl: (queryParams) =>
      buildDataTableUrl('/api/vehicles', queryParams, {
        searchFallbackFilterFields: ['make', 'model', 'vin', 'plate'],
      }),
  },
]

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown[] }).data)) {
    return (payload as { data: unknown[] }).data
  }
  return []
}

export function resolveWidgetSourceByPath(pathname: string): WidgetSourceDefinition | null {
  return widgetSourceDefinitions.find((source) => pathname.startsWith(source.pathPrefix)) ?? null
}

export async function fetchRowsForWidgetHref(href: string): Promise<unknown[]> {
  const url = new URL(href, 'http://localhost')
  const source = resolveWidgetSourceByPath(url.pathname)
  if (!source) return []

  const queryParams = parseDataTableQueryParams(url.searchParams)
  const queryForDashboard: DataTableQueryParams = {
    ...queryParams,
    page: 1,
    pageSize: Math.max(200, queryParams.pageSize),
  }

  const apiUrl = source.buildApiUrl(queryForDashboard)
  const response = await fetchWithAuth(apiUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch widget data for ${source.key}`)
  }
  const payload = (await response.json()) as unknown
  const rows = extractRows(payload)
  return applyClientFiltersAndSort(rows, queryParams)
}

