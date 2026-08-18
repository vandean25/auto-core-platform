import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SalesOrder } from './types'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { buildDataTableUrl } from './data-table-query'

export const salesOrderKeys = {
    all: ['sales-orders'] as const,
    list: (queryParams?: DataTableQueryParams) => [...salesOrderKeys.all, 'list', queryParams] as const,
    detail: (id: string) => [...salesOrderKeys.all, 'detail', id] as const,
}

type SalesOrderListResponse = {
    data: SalesOrder[]
    meta: {
        total: number
        page: number
        pageSize: number
        pageCount: number
    }
}

type SalesOrderMutationPayload = Record<string, unknown>

export function useSalesOrders(queryParams?: DataTableQueryParams) {
    return useQuery<SalesOrderListResponse>({
        queryKey: salesOrderKeys.list(queryParams),
        queryFn: async () => {
            const url = buildDataTableUrl('/api/sales-orders', queryParams, {
                sortFieldMap: { customer: 'customer.last_name' },
                searchFallbackFilterFields: ['order_number'],
                exactFilterMap: { status: 'status' },
            })
            
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
        mutationFn: async (order: SalesOrderMutationPayload & { signal?: AbortSignal }) => {
            const { signal, ...payload } = order
            const response = await fetchWithAuth('/api/sales-orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal,
            })
            if (!response.ok) throw new Error('Failed to create sales order')
            return response.json() as Promise<SalesOrder>
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: salesOrderKeys.all })
        },
    })
}

export function useUpdateSalesOrder() {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: async ({
            id,
            data,
            signal,
        }: {
            id: string
            data: SalesOrderMutationPayload
            signal?: AbortSignal
        }) => {
            const response = await fetchWithAuth(`/api/sales-orders/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal,
            })
            if (!response.ok) throw new Error('Failed to update sales order')
            return response.json() as Promise<SalesOrder>
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

export function useDeleteSalesOrder() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetchWithAuth(`/api/sales-orders/${id}`, {
                method: 'DELETE',
            })
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to delete sales order' }))
                throw new Error(error.message || 'Failed to delete sales order')
            }
            return id
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: salesOrderKeys.all })
        },
    })
}
