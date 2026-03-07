import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PurchaseOrder } from './types'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'

const PO_API = '/api/purchase-orders'

export function usePurchaseOrders(queryParams?: DataTableQueryParams) {
    return useQuery<any>({
        queryKey: ['purchase-orders', queryParams],
        queryFn: async () => {
            const url = buildDataTableUrl(PO_API, queryParams, {
                sortFieldMap: { vendor: 'vendor.name' },
                searchFallbackFilterFields: ['order_number'],
                exactFilterMap: { status: 'status' },
            })

            const res = await fetchWithAuth(url)
            if (!res.ok) throw new Error('Failed to fetch purchase orders')
            return res.json()
        },
        placeholderData: (previousData: any) => previousData, 
    })
}

export function useCreatePO() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: { vendorId: string; items: { catalogItemId: string; quantity: number; unitCost: number }[] }) => {
            const res = await fetchWithAuth(PO_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) throw new Error('Failed to create PO')
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
        },
    })
}

export function usePurchaseOrder(id: string) {
    return useQuery({
        queryKey: ['purchase-orders', id],
        queryFn: async () => {
            // The endpoint isn't explicitly defined in my previous view_file of controller, but usually we need one.
            // I see `receiveItems` uses `:id/receive`.
            // I should probably add `@Get(':id')` to backend too.
            const res = await fetchWithAuth(`${PO_API}/${id}`)
            if (!res.ok) throw new Error('Failed to fetch PO')
            return res.json() as Promise<PurchaseOrder>
        },
        enabled: !!id,
    })
}

export function useReceiveGoods() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ orderId, items }: { orderId: string; items: { itemId: string; quantity: number }[] }) => {
            const res = await fetchWithAuth(`${PO_API}/${orderId}/receive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
            })
            if (!res.ok) throw new Error('Failed to receive goods')
            return res.json()
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders', variables.orderId] })
            queryClient.invalidateQueries({ queryKey: ['inventory'] }) // Update stock lists
        },
    })
}

export function useAddPOItems() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ orderId, items }: { orderId: string; items: { catalogItemId: string; quantity: number; unitCost: number }[] }) => {
            const res = await fetchWithAuth(`${PO_API}/${orderId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(items),
            })
            if (!res.ok) throw new Error('Failed to add items to PO')
            return res.json()
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders', variables.orderId] })
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
        },
    })
}

export function useUpdatePOItem() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ orderId, itemId, updates }: { orderId: string; itemId: string; updates: { quantity?: number; unitCost?: number } }) => {
            const res = await fetchWithAuth(`${PO_API}/${orderId}/items/${itemId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            })
            if (!res.ok) throw new Error('Failed to update PO item')
            return res.json()
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders', variables.orderId] })
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
        },
    })
}

export function useDeletePOItem() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ orderId, itemId }: { orderId: string; itemId: string }) => {
            const res = await fetchWithAuth(`${PO_API}/${orderId}/items/${itemId}`, {
                method: 'DELETE',
            })
            if (!res.ok) throw new Error('Failed to delete PO item')
            return res.json()
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders', variables.orderId] })
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
        },
    })
}

export function useDeletePurchaseOrder() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (id: string) => {
            const res = await fetchWithAuth(`${PO_API}/${id}`, {
                method: 'DELETE',
            })
            if (!res.ok) {
                const error = await res.json().catch(() => ({ message: 'Failed to delete purchase order' }))
                throw new Error(error.message || 'Failed to delete purchase order')
            }
            return id
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
        },
    })
}

