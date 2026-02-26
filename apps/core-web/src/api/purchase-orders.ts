import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PurchaseOrder } from './types'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'

const PO_API = '/api/purchase-orders'

export function usePurchaseOrders(queryParams?: DataTableQueryParams) {
    return useQuery<any>({
        queryKey: ['purchase-orders', queryParams],
        queryFn: async () => {
            let url = PO_API
            if (queryParams) {
                const params = new URLSearchParams()
                params.append('page', String(queryParams.page))
                params.append('pageSize', String(queryParams.pageSize))
                if (queryParams.sortDirection) params.append('sortDirection', queryParams.sortDirection)
                if (queryParams.sortField) {
                    const sortField = queryParams.sortField === 'vendor' ? 'vendor.name' : queryParams.sortField
                    params.append('sortField', sortField)
                }

                const orderNumberFilter = queryParams.filters.find((f) => f.field === 'order_number')?.value
                const statusFilter = queryParams.filters.find((f) => f.field === 'status')?.value
                const search = queryParams.search ?? orderNumberFilter
                if (search) params.append('search', search)
                if (statusFilter) params.append('status', statusFilter)

                url += `?${params.toString()}`
            }
            
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
