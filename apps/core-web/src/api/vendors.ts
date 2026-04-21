import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'
import type { Vendor } from './types'

const VENDORS_API = '/api/vendors'

export const vendorKeys = {
    all: ['vendors'] as const,
    list: (queryParams?: DataTableQueryParams) => [...vendorKeys.all, 'list', queryParams] as const,
    detail: (id: string) => [...vendorKeys.all, 'detail', id] as const,
}

type VendorListResponse = {
    data: Vendor[]
    meta: {
        total: number
        page: number
        pageSize: number
        pageCount: number
    }
}

export function useVendors(queryParams?: DataTableQueryParams) {
    return useQuery<VendorListResponse>({
        queryKey: vendorKeys.list(queryParams),
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

export function useVendor<TVendor = Vendor>(id: string) {
    return useQuery<TVendor>({
        queryKey: vendorKeys.detail(id),
        queryFn: async () => {
            const res = await fetchWithAuth(`${VENDORS_API}/${id}`)
            if (!res.ok) throw new Error('Failed to fetch vendor')
            return res.json()
        },
        enabled: !!id,
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
            queryClient.invalidateQueries({ queryKey: vendorKeys.all })
        },
    })
}

export function useUpdateVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ id, data }: {
            id: string
            data: Partial<Vendor> & { brandIds?: number[] }
        }) => {
            const res = await fetchWithAuth(`${VENDORS_API}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: data.name,
                    email: data.email,
                    accountNumber: data.account_number,
                    brandIds: data.brandIds,
                }),
            })
            if (!res.ok) throw new Error('Failed to update vendor')
            return res.json()
        },
        onSuccess: (updatedVendor) => {
            queryClient.invalidateQueries({ queryKey: vendorKeys.all })
            queryClient.invalidateQueries({ queryKey: vendorKeys.detail(updatedVendor.id) })
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
            queryClient.invalidateQueries({ queryKey: vendorKeys.all })
        },
    })
}
