import { useQuery } from '@tanstack/react-query'
import type { InventoryResponse, InventoryTransaction } from './types'

export const inventoryKeys = {
    all: ['inventory'] as const,
    list: (params: { page?: number; limit?: number; search?: string }) => [...inventoryKeys.all, 'list', params] as const,
    history: (itemId: string) => [...inventoryKeys.all, 'history', itemId] as const,
}

export function useInventory(params: { page?: number; limit?: number; search?: string; brand?: string } = {}) {
    return useQuery<InventoryResponse>({
        queryKey: [...inventoryKeys.list(params), params.brand],
        queryFn: async () => {
            const searchParams = new URLSearchParams()
            if (params.page) searchParams.append('page', params.page.toString())
            if (params.limit) searchParams.append('limit', params.limit.toString())
            if (params.search) searchParams.append('search', params.search)
            if (params.brand) searchParams.append('brand', params.brand)

            const response = await fetch(`/api/inventory?${searchParams.toString()}`)
            if (!response.ok) {
                throw new Error('Network response was not ok')
            }
            return response.json()
        },
    })
}

export function useInventoryHistory(itemId: string) {
    return useQuery<InventoryTransaction[]>({
        queryKey: inventoryKeys.history(itemId),
        queryFn: async () => {
            const response = await fetch(`/api/inventory/${itemId}/history`)
            if (!response.ok) {
                throw new Error('Failed to fetch inventory history')
            }
            return response.json()
        },
        enabled: !!itemId,
    })
}
