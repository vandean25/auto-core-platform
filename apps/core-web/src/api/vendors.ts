import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'

const VENDORS_API = '/api/vendors'

export function useVendors(queryParams?: DataTableQueryParams) {
    return useQuery<any>({
        queryKey: ['vendors', queryParams],
        queryFn: async () => {
            let url = VENDORS_API
            if (queryParams) {
                const params = new URLSearchParams()
                params.append('page', String(queryParams.page))
                params.append('pageSize', String(queryParams.pageSize))
                if (queryParams.sortField) params.append('sortField', queryParams.sortField)
                if (queryParams.sortDirection) params.append('sortDirection', queryParams.sortDirection)

                const nameFilter = queryParams.filters.find((f) => f.field === 'name')?.value
                const search = queryParams.search ?? nameFilter
                if (search) params.append('search', search)

                url += `?${params.toString()}`
            }
            const res = await fetchWithAuth(url)
            if (!res.ok) throw new Error('Failed to fetch vendors')
            return res.json()
        },
    })
}

export function useCreateVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: {
            name: string;
            email: string;
            account_number: string;
            brandIds: number[];
        }) => {
            const res = await fetchWithAuth(VENDORS_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: data.name,
                    email: data.email,
                    accountNumber: data.account_number,
                    brandIds: data.brandIds
                }),
            })
            if (!res.ok) throw new Error('Failed to create vendor')
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vendors'] })
        },
    })
}
