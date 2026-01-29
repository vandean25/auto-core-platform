import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { InventoryResponse } from '@/api/types'
import { inventoryKeys } from '@/api/inventory'

export function useGlobalSearch(searchTerm: string) {
    const [debouncedSearch, setDebouncedSearch] = useState(searchTerm)

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchTerm)
        }, 300)

        return () => clearTimeout(timer)
    }, [searchTerm])

    return useQuery<InventoryResponse>({
        queryKey: inventoryKeys.list({ search: debouncedSearch, limit: 3 }),
        queryFn: async () => {
            if (!debouncedSearch) return { data: [], meta: { total: 0, page: 1, limit: 3, totalPages: 0 } }

            const searchParams = new URLSearchParams()
            searchParams.append('search', debouncedSearch)
            searchParams.append('limit', '3')

            const response = await fetch(`/api/inventory?${searchParams.toString()}`)
            if (!response.ok) {
                throw new Error('Search failed')
            }
            return response.json()
        },
        enabled: debouncedSearch.length > 0,
    })
}
