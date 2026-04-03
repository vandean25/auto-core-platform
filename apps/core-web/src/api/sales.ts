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
        mutationFn: async (payload: CreateInvoicePayload) => {
            const response = await fetchWithAuth('/api/sales/invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            if (!response.ok) throw new Error('Failed to create invoice')
            return response.json() as Promise<Invoice>
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

export async function downloadInvoicePdf(invoiceId: string): Promise<Blob> {
    // 1. Ensure generation
    const genRes = await fetchWithAuth(`/api/invoices/${invoiceId}/pdf`, {
        method: 'POST'
    })
    if (!genRes.ok) {
        throw new Error('Failed to generate invoice PDF')
    }

    // 2. Fetch the file
    const response = await fetchWithAuth(`/api/invoices/${invoiceId}/pdf`)
    if (!response.ok) {
        throw new Error('Failed to download invoice PDF')
    }
    return response.blob()
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
