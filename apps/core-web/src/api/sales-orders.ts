import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SalesOrder, SalesOrderStatus } from './types'

export const salesOrderKeys = {
    all: ['sales-orders'] as const,
    list: (status?: SalesOrderStatus) => [...salesOrderKeys.all, 'list', status] as const,
    detail: (id: string) => [...salesOrderKeys.all, 'detail', id] as const,
}

export function useSalesOrders(status?: SalesOrderStatus) {
    return useQuery<SalesOrder[]>({
        queryKey: salesOrderKeys.list(status),
        queryFn: async () => {
            const params = new URLSearchParams()
            if (status) params.append('status', status)
            
            const response = await fetch(`/api/sales-orders?${params.toString()}`)
            if (!response.ok) throw new Error('Failed to fetch sales orders')
            return response.json()
        },
    })
}

export function useSalesOrder(id: string) {
    return useQuery<SalesOrder>({
        queryKey: salesOrderKeys.detail(id),
        queryFn: async () => {
            const response = await fetch(`/api/sales-orders/${id}`)
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
            const response = await fetch('/api/sales-orders', {
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
            const response = await fetch(`/api/sales-orders/${id}`, {
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
            const response = await fetch(`/api/sales-orders/${id}/create-invoice`, {
                method: 'POST',
            })
            if (!response.ok) throw new Error('Failed to create invoice from order')
            return response.json()
        },
        onSuccess: (invoice, orderId) => {
            queryClient.invalidateQueries({ queryKey: salesOrderKeys.detail(orderId) })
            // We might also want to invalidate invoices list if we had one
        },
    })
}
