import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SalesOrder } from './types'
import { fetchWithAuth } from './client'

export const salesOrderKeys = {
    all: ['sales-orders'] as const,
    list: (queryParams?: string) => [...salesOrderKeys.all, 'list', queryParams] as const,
    detail: (id: string) => [...salesOrderKeys.all, 'detail', id] as const,
}

export function useSalesOrders(queryParams?: string) {
    return useQuery<any>({
        queryKey: salesOrderKeys.list(queryParams),
        queryFn: async () => {
            let url = '/api/sales-orders'
            if (queryParams) {
                if (queryParams.startsWith('{')) {
                    url += `?params=${encodeURIComponent(queryParams)}`
                } else {
                    const params = new URLSearchParams()
                    params.append('status', queryParams)
                    url += `?${params.toString()}`
                }
            }
            
            const response = await fetchWithAuth(url)
            if (!response.ok) throw new Error('Failed to fetch sales orders')
            return response.json()
        },
    })
}

export function useSalesOrder(id: string) {
    return useQuery<SalesOrder>({
        queryKey: salesOrderKeys.detail(id),
        queryFn: async () => {
            const response = await fetchWithAuth(`/api/sales-orders/${id}`)
            if (!response.ok) throw new Error('Failed to fetch sales order')
            return response.json()
        },
        enabled: !!id,
    })
}

export function useCreateSalesOrder() {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: async (order: any) => {
            const response = await fetchWithAuth('/api/sales-orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(order),
            })
            if (!response.ok) throw new Error('Failed to create sales order')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: salesOrderKeys.all })
        },
    })
}

export function useUpdateSalesOrder() {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) => {
            const response = await fetchWithAuth(`/api/sales-orders/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) throw new Error('Failed to update sales order')
            return response.json()
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: salesOrderKeys.all })
            queryClient.invalidateQueries({ queryKey: salesOrderKeys.detail(data.id) })
        },
    })
}

export function useCreateInvoiceFromOrder() {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetchWithAuth(`/api/sales-orders/${id}/create-invoice`, {
                method: 'POST',
            })
            if (!response.ok) throw new Error('Failed to create invoice from order')
            return response.json()
        },
        onSuccess: (_invoice, orderId) => {
            queryClient.invalidateQueries({ queryKey: salesOrderKeys.detail(orderId) })
            // We might also want to invalidate invoices list if we had one
        },
    })
}
