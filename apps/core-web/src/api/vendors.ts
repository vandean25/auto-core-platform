import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { isVendorUpdateOptimisticEligible } from '@/features/interaction/parts-purchasing-update-eligibility'
import { optimisticMutationOptions } from '@/lib/optimistic-mutation'
import { patchRecordInCache, restoreRecordFields } from '@/lib/optimistic-record-patch'
import { throwApiResponseError } from './api-error'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'
import type { Vendor, VendorArticle } from './types'

const VENDORS_API = '/api/vendors'

export const vendorKeys = {
    all: ['vendors'] as const,
    lists: () => [...vendorKeys.all, 'list'] as const,
    list: (queryParams?: DataTableQueryParams) => [...vendorKeys.all, 'list', queryParams] as const,
    detail: (id: string) => [...vendorKeys.all, 'detail', id] as const,
    articles: (vendorId: string) => [...vendorKeys.all, 'articles', vendorId] as const,
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
        mutationKey: [...vendorKeys.all, 'create'],
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
            if (!res.ok) await throwApiResponseError(res, 'Failed to create vendor')
            return res.json() as Promise<{ id: string }>
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: vendorKeys.all })
        },
    })
}

type UpdateVendorVariables = { id: string; data: Partial<Vendor> & { brandIds?: number[] } }

const updateVendorOptimistic = optimisticMutationOptions<unknown, UpdateVendorVariables>({
    queryKey: ({ id }) => vendorKeys.detail(id),
    mutationKey: [...vendorKeys.all, 'update'],
    entityId: ({ id }) => id,
    shouldOptimistic: isVendorUpdateOptimisticEligible,
    apply: (cache, { id, data }) => patchRecordInCache(cache, id, data),
    revert: (cache, { id, data }, snapshot) => restoreRecordFields(cache, id, Object.keys(data), snapshot),
    prefixCaches: [
        {
            queryKey: () => vendorKeys.lists(),
            apply: (cache, { id, data }) => patchRecordInCache(cache, id, data),
            revert: (cache, { id, data }, snapshot) => restoreRecordFields(cache, id, Object.keys(data), snapshot),
        },
    ],
})

export function useUpdateVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        ...updateVendorOptimistic,
        mutationFn: async ({ id, data }: UpdateVendorVariables) => {
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
            if (!res.ok) await throwApiResponseError(res, 'Failed to update vendor')
            return res.json()
        },
        // An optimistic edit is reconciled by the helper on settle. Brands stay server-confirmed and refetch here.
        onSuccess: (_data, variables) => {
            if (!isVendorUpdateOptimisticEligible(variables)) {
                queryClient.invalidateQueries({ queryKey: vendorKeys.all })
            }
        },
    })
}

export function useDeleteVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationKey: [...vendorKeys.all, 'delete'],
        mutationFn: async (id: string) => {
            const res = await fetchWithAuth(`${VENDORS_API}/${id}`, {
                method: 'DELETE',
            })
            if (!res.ok) await throwApiResponseError(res, 'Failed to delete vendor')
            return id
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: vendorKeys.all })
        },
    })
}

export function useVendorArticles(vendorId: string | null | undefined) {
    return useQuery({
        queryKey: vendorKeys.articles(vendorId ?? ''),
        enabled: Boolean(vendorId),
        queryFn: async () => {
            const res = await fetchWithAuth(`${VENDORS_API}/${vendorId}/articles`)
            if (!res.ok) {
                const error = await res.json().catch(() => ({ message: 'Failed to load vendor articles' }))
                throw new Error(error.message || 'Failed to load vendor articles')
            }
            return res.json() as Promise<VendorArticle[]>
        },
    })
}
