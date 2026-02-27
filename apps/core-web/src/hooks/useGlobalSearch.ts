import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { InventoryResponse } from '@/api/types'
import { inventoryKeys } from '@/api/inventory'
import { fetchWithAuth } from '@/api/client'

export function useGlobalSearch(searchTerm: string) {
    const [debouncedSearch, setDebouncedSearch] = useState(searchTerm)
    const pageSize = 3

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchTerm)
        }, 300)

        return () => clearTimeout(timer)
    }, [searchTerm])

    return useQuery<InventoryResponse>({
        queryKey: inventoryKeys.list({ search: debouncedSearch, pageSize }),
        queryFn: async () => {
            if (!debouncedSearch) return { data: [], meta: { total: 0, page: 1, limit: pageSize, totalPages: 0 } }

            const searchParams = new URLSearchParams()
            searchParams.append('search', debouncedSearch)
            searchParams.append('pageSize', String(pageSize))

            const response = await fetchWithAuth(`/api/inventory?${searchParams.toString()}`)
            if (!response.ok) {
                throw new Error('Search failed')
            }
            return response.json()
        },
        enabled: debouncedSearch.length > 0,
    })
}
