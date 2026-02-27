import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'

const VENDORS_API = '/api/vendors'

export function useVendors(queryParams?: DataTableQueryParams) {
    return useQuery<any>({
        queryKey: ['vendors', queryParams],
        queryFn: async () => {
            const url = buildDataTableUrl(VENDORS_API, queryParams, {
                searchFallbackFilterFields: ['name'],
            })
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

export function useDeleteVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (id: string) => {
            const res = await fetchWithAuth(`${VENDORS_API}/${id}`, {
                method: 'DELETE',
            })
            if (!res.ok) {
                const error = await res.json().catch(() => ({ message: 'Failed to delete vendor' }))
                throw new Error(error.message || 'Failed to delete vendor')
            }
            return id
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vendors'] })
        },
    })
}
