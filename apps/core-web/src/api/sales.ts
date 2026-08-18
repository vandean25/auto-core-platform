import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Invoice } from './types'
import { fetchWithAuth } from './client'

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

export function useCreateInvoice() {
    return useMutation({
        mutationFn: async ({
            signal,
            ...payload
        }: CreateInvoicePayload & { signal?: AbortSignal }) => {
            const response = await fetchWithAuth('/api/sales/invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal,
            })
            if (!response.ok) throw new Error('Failed to create invoice')
            return response.json() as Promise<Invoice>
        },
    })
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
            if (!response.ok) throw new Error('Failed to update invoice')
            return response.json() as Promise<Invoice>
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['invoices', data.id] })
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
            if (!response.ok) throw new Error('Failed to finalize invoice')
            return response.json() as Promise<Invoice>
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['invoices', data.id] })
        },
    })
}

export function useInvoice(id: string) {
    return useQuery<Invoice>({
        queryKey: ['invoices', id],
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
             return response.json()
        },
        enabled: !!id,
    })
}
