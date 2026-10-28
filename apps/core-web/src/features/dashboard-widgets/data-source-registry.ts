import { buildDataTableUrl } from '@/api/data-table-query'
import { fetchWithAuth } from '@/api/client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { applyClientFiltersAndSort, parseDataTableQueryParams } from '@/features/dashboard-widgets/utils'
import { isAbortError } from '@/lib/error-utils'
import { MAX_LIST_PAGE_SIZE, MAX_VEHICLE_LIST_PAGE_SIZE } from '@/lib/list-page-size'

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
      params.set('pageSize', String(MAX_LIST_PAGE_SIZE))
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
      params.set('pageSize', String(MAX_LIST_PAGE_SIZE))
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
      params.set('pageSize', String(MAX_LIST_PAGE_SIZE))
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
    key: 'pickerl-due',
    pathPrefix: '/vehicles/pickerl-due',
    buildApiUrl: (queryParams) => {
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('pageSize', String(MAX_VEHICLE_LIST_PAGE_SIZE))
      const windowFilter = queryParams.filters.find((filter) => filter.field === 'window')?.value
      if (windowFilter) params.set('window', windowFilter)
      const statusFilter = queryParams.filters.find((filter) => filter.field === 'status')?.value
      if (statusFilter) params.set('status', statusFilter)
      return `/api/vehicles/pickerl-due?${params.toString()}`
    },
  },
  {
    key: 'vehicles',
    pathPrefix: '/vehicles',
    buildApiUrl: (queryParams) =>
      buildDataTableUrl('/api/vehicles', queryParams, {
        searchFallbackFilterFields: ['make', 'model', 'vin', 'plate'],
        maxPageSize: MAX_VEHICLE_LIST_PAGE_SIZE,
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

export type WidgetRequest = {
  apiUrl: string
  /** Query params parsed from the widget href; they are applied on the client over the fetched rows. */
  queryParams: DataTableQueryParams
}

/** The API request behind a widget href, or null when no widget source serves the href. */
export function resolveWidgetRequest(href: string): WidgetRequest | null {
  const url = new URL(href, 'http://localhost')
  const source = resolveWidgetSourceByPath(url.pathname)
  if (!source) return null

  const queryParams = parseDataTableQueryParams(url.searchParams)
  const queryForDashboard: DataTableQueryParams = {
    ...queryParams,
    page: 1,
    pageSize: MAX_LIST_PAGE_SIZE,
  }

  return { apiUrl: source.buildApiUrl(queryForDashboard), queryParams }
}

/** Rows of one API URL, unfiltered: widgets with different client-side filters share them. */
export async function fetchWidgetRows(apiUrl: string, sourceKey: string): Promise<unknown[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetchWithAuth(apiUrl, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Failed to fetch widget data for ${sourceKey}`)
    }
    return extractRows((await response.json()) as unknown)
  } catch (error: unknown) {
    if (isAbortError(error)) {
      console.warn(`Fetch for widget ${sourceKey} timed out after 10s`)
      return []
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export function filterWidgetRows(rows: unknown[], request: WidgetRequest | null): unknown[] {
  return request ? applyClientFiltersAndSort(rows, request.queryParams) : rows
}
