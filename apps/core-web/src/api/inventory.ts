import { useQuery } from '@tanstack/react-query'
import type { InventoryResponse } from './types'

export const inventoryKeys = {
    all: ['inventory'] as const,
    list: (params: { page?: number; limit?: number; search?: string }) => [...inventoryKeys.all, 'list', params] as const,
}

export function useInventory(params: { page?: number; limit?: number; search?: string } = {}) {
    return useQuery<InventoryResponse>({
        queryKey: inventoryKeys.list(params),
        queryFn: async () => {
            const searchParams = new URLSearchParams()
            if (params.page) searchParams.append('page', params.page.toString())
            if (params.limit) searchParams.append('limit', params.limit.toString())
            if (params.search) searchParams.append('search', params.search)

            const response = await fetch(`/api/inventory?${searchParams.toString()}`)
            if (!response.ok) {
                throw new Error('Network response was not ok')
            }
            return response.json()
        },
    })
}
