import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { 
    UnbilledReceiptItem, 
    CreatePurchaseInvoiceDto, 
    PurchaseInvoice, 
    PurchaseInvoiceStatus 
} from './types'
import { fetchWithAuth } from './client'

export const purchaseInvoiceKeys = {
    all: ['purchase-invoices'] as const,
    list: (params: { vendorId?: string; status?: string }) => [...purchaseInvoiceKeys.all, 'list', params] as const,
    detail: (id: string) => [...purchaseInvoiceKeys.all, 'detail', id] as const,
    unbilled: (vendorId?: string) => [...purchaseInvoiceKeys.all, 'unbilled', vendorId] as const,
}

export function useUnbilledReceipts(vendorId: string | undefined) {
    return useQuery<UnbilledReceiptItem[]>({
        queryKey: purchaseInvoiceKeys.unbilled(vendorId),
        queryFn: async () => {
            if (!vendorId) return []
            const response = await fetchWithAuth(`/api/vendors/${vendorId}/unbilled-receipts`)
            if (!response.ok) throw new Error('Failed to fetch unbilled receipts')
            return response.json()
        },
        enabled: !!vendorId,
    })
}

export interface PurchaseInvoicesParams {
    vendorId?: string
    status?: PurchaseInvoiceStatus
    page?: number
    pageSize?: number
    sortBy?: string
    order?: 'asc' | 'desc'
}

export interface PurchaseInvoicesResponse {
    data: PurchaseInvoice[]
    meta: {
        total: number
        page: number
        pageSize: number
        pageCount: number
    }
}

export function usePurchaseInvoices(params: PurchaseInvoicesParams = {}) {
    return useQuery<PurchaseInvoicesResponse>({
        queryKey: purchaseInvoiceKeys.list(params),
        queryFn: async () => {
            const searchParams = new URLSearchParams()
            if (params.vendorId) searchParams.append('vendorId', params.vendorId)
            if (params.status) searchParams.append('status', params.status)
            if (params.page) searchParams.append('page', params.page.toString())
            if (params.pageSize) searchParams.append('pageSize', params.pageSize.toString())
            if (params.sortBy) searchParams.append('sortBy', params.sortBy)
            if (params.order) searchParams.append('order', params.order)
            
            const response = await fetchWithAuth(`/api/purchase-invoices?${searchParams.toString()}`)
            if (!response.ok) throw new Error('Failed to fetch purchase invoices')
            return response.json()
        },
    })
}

export function usePurchaseInvoice(id: string) {
    return useQuery<PurchaseInvoice>({
        queryKey: purchaseInvoiceKeys.detail(id),
        queryFn: async () => {
            const response = await fetchWithAuth(`/api/purchase-invoices/${id}`)
            if (!response.ok) throw new Error('Failed to fetch purchase invoice')
            return response.json()
        },
        enabled: !!id,
    })
}

export function useCreatePurchaseInvoice() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: CreatePurchaseInvoiceDto) => {
            const response = await fetchWithAuth('/api/purchase-invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            if (!response.ok) throw new Error('Failed to create purchase invoice')
            return response.json() as Promise<PurchaseInvoice>
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: purchaseInvoiceKeys.all })
        },
    })
}

export function usePostPurchaseInvoice() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetchWithAuth(`/api/purchase-invoices/${id}/post`, {
                method: 'PATCH',
            })
            if (!response.ok) throw new Error('Failed to post purchase invoice')
            return response.json() as Promise<PurchaseInvoice>
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: purchaseInvoiceKeys.all })
            queryClient.invalidateQueries({ queryKey: purchaseInvoiceKeys.detail(data.id) })
        },
    })
}
