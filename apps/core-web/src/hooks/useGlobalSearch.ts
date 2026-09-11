import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  InventoryItem,
  InventoryResponse,
  WorkshopOrder,
  WorkshopSearchResponse,
} from '@/api/types'
import type { components } from '@/api/generated/openapi'
import { inventoryKeys } from '@/api/inventory'
import { workshopKeys } from '@/api/workshop'
import { fetchWithAuth } from '@/api/client'
import { buildDataTableUrl } from '@/api/data-table-query'

export type WorkshopSearchCustomer = components['schemas']['WorkshopSearchCustomerDto']
export type WorkshopSearchVehicle = components['schemas']['WorkshopSearchVehicleDto']

export interface GlobalSearchResults {
  inventory: InventoryItem[]
  customers: WorkshopSearchCustomer[]
  vehicles: WorkshopSearchVehicle[]
  orders: WorkshopOrder[]
}

const GLOBAL_SEARCH_CAP = 5
const SEARCH_DEBOUNCE_MS = 300

export function useGlobalSearch(searchTerm: string) {
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [searchTerm])

  const query = debouncedSearch.trim()
  const isEnabled = query.length > 0

  // 1. Inventory query (cap 5)
  const inventoryQuery = useQuery<InventoryResponse>({
    queryKey: inventoryKeys.list({ search: query, pageSize: GLOBAL_SEARCH_CAP }),
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      searchParams.append('search', query)
      searchParams.append('pageSize', String(GLOBAL_SEARCH_CAP))

      const response = await fetchWithAuth(`/api/inventory?${searchParams.toString()}`)
      if (!response.ok) {
        throw new Error('Inventory search failed')
      }
      return response.json()
    },
    enabled: isEnabled,
  })

  // 2. Customers + Vehicles via GET /api/workshop/search?q=
  const workshopSearchQuery = useQuery<WorkshopSearchResponse>({
    queryKey: workshopKeys.search(query),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/workshop/search?q=${encodeURIComponent(query)}`)
      if (!response.ok) {
        throw new Error('Workshop entity search failed')
      }
      return response.json()
    },
    enabled: isEnabled,
  })

  // 3. Workshop Orders via GET /api/workshop/orders?search= (cap 5)
  const workshopOrdersQuery = useQuery<{ data: WorkshopOrder[] }>({
    queryKey: workshopKeys.ordersPage({ search: query, pageSize: GLOBAL_SEARCH_CAP, page: 1, filters: [] }),
    queryFn: async () => {
      const url = buildDataTableUrl('/api/workshop/orders', {
        search: query,
        pageSize: GLOBAL_SEARCH_CAP,
        page: 1,
        filters: [],
      }, {
        searchFallbackFilterFields: [
          'order_number',
          'id',
          'customer.first_name',
          'customer.last_name',
          'vehicle.make',
          'vehicle.model',
          'vehicle.plate',
        ],
      })
      const response = await fetchWithAuth(url)
      if (!response.ok) {
        throw new Error('Workshop orders search failed')
      }
      return response.json()
    },
    enabled: isEnabled,
  })

  const data = useMemo<GlobalSearchResults>(() => {
    if (!isEnabled) {
      return {
        inventory: [],
        customers: [],
        vehicles: [],
        orders: [],
      }
    }

    const inventory = (inventoryQuery.data?.data ?? []).slice(0, GLOBAL_SEARCH_CAP)
    const customers = (workshopSearchQuery.data?.data?.customers ?? []).slice(0, GLOBAL_SEARCH_CAP)
    const vehicles = (workshopSearchQuery.data?.data?.vehicles ?? []).slice(0, GLOBAL_SEARCH_CAP)
    const orders = (workshopOrdersQuery.data?.data ?? []).slice(0, GLOBAL_SEARCH_CAP)

    return {
      inventory,
      customers,
      vehicles,
      orders,
    }
  }, [
    isEnabled,
    inventoryQuery.data,
    workshopSearchQuery.data,
    workshopOrdersQuery.data,
  ])

  const isLoading = Boolean(
    isEnabled &&
      (inventoryQuery.isLoading ||
        workshopSearchQuery.isLoading ||
        workshopOrdersQuery.isLoading),
  )

  const isFetching = Boolean(
    isEnabled &&
      (inventoryQuery.isFetching ||
        workshopSearchQuery.isFetching ||
        workshopOrdersQuery.isFetching),
  )

  const error =
    inventoryQuery.error ||
    workshopSearchQuery.error ||
    workshopOrdersQuery.error ||
    null

  return {
    data,
    isLoading,
    isFetching,
    error: error as Error | null,
  }
}
