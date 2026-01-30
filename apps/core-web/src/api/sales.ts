import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Invoice } from './types'

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
            const response = await fetch('/api/sales/invoices', {
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
            const response = await fetch(`/api/sales/invoices/${invoiceId}/finalize`, {
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
             const response = await fetch(`/api/sales/invoices/${id}`)
             if (!response.ok) throw new Error('Failed to fetch invoice')
             return response.json()
        },
        enabled: !!id,
    })
}
