import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Invoice } from './types'
import { fetchWithAuth } from './client'
import { throwIfSalesResponseNotOk } from './sales-api-errors'
import { DETAIL_PREFETCH_GC_MS, DETAIL_PREFETCH_STALE_MS } from '@/lib/intent-prefetch'

export const invoiceKeys = {
    all: ['invoices'] as const,
    detail: (id: string) => [...invoiceKeys.all, id] as const,
}

export interface CreateInvoicePayload {
    customerId: string
    vehicleId?: string
    items: {
        catalogItemId?: string
        description: string
        quantity: number
        unitPrice: number
        taxRate: number
    }[]
    notes?: string
    internalNotes?: string
}

export function useUpdateInvoice() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({
            id,
            payload,
            signal,
        }: {
            id: string
            payload: CreateInvoicePayload
            signal?: AbortSignal
        }) => {
            const response = await fetchWithAuth(`/api/sales/invoices/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal,
            })
            await throwIfSalesResponseNotOk(response, 'Failed to update invoice')
            return response.json() as Promise<Invoice>
        },
        onSuccess: (data) => {
            queryClient.setQueryData(invoiceKeys.detail(data.id), data)
            queryClient.invalidateQueries({ queryKey: invoiceKeys.all })
        },
    })
}

export function useFinalizeInvoice() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (invoiceId: string) => {
            const response = await fetchWithAuth(`/api/sales/invoices/${invoiceId}/finalize`, {
                method: 'PUT',
            })
            await throwIfSalesResponseNotOk(response, 'Failed to finalize invoice')
            return response.json() as Promise<Invoice>
        },
        onSuccess: (data) => {
            queryClient.setQueryData(invoiceKeys.detail(data.id), data)
            queryClient.invalidateQueries({ queryKey: invoiceKeys.all })
        },
    })
}

export function useInvoices() {
    return useQuery<Invoice[]>({
        queryKey: invoiceKeys.all,
        queryFn: async () => {
            const response = await fetchWithAuth('/api/sales/invoices')
            if (!response.ok) throw new Error('Failed to fetch invoices')
            return response.json() as Promise<Invoice[]>
        },
    })
}

export const INVOICE_DETAIL_STALE_MS = DETAIL_PREFETCH_STALE_MS

export function invoiceDetailQueryOptions(id: string) {
    return {
        queryKey: invoiceKeys.detail(id),
        queryFn: async () => {
             const response = await fetchWithAuth(`/api/sales/invoices/${id}`)
             if (!response.ok) {
                const payload = await response.json().catch(() => ({}))
                const error = new Error(payload?.message || 'Failed to fetch invoice') as Error & {
                    status?: number
                    response?: { status: number; data: unknown }
                }
                error.status = response.status
                error.response = { status: response.status, data: payload }
                throw error
             }
             return response.json() as Promise<Invoice>
        },
        staleTime: INVOICE_DETAIL_STALE_MS,
        gcTime: DETAIL_PREFETCH_GC_MS,
    }
}

export function useInvoice(id: string) {
    return useQuery<Invoice>({
        ...invoiceDetailQueryOptions(id),
        enabled: !!id,
    })
}
