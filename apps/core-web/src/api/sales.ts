import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Invoice } from './types'
import { fetchWithAuth } from './client'
import { withScopeContextHeader } from '@/auth/scope-context-client'
import { useCursorList } from './cursor-list'
import { throwIfSalesResponseNotOk } from './sales-api-errors'
import { isInvoiceUpdateOptimisticEligible } from '@/features/interaction/invoice-update-eligibility'
import { optimisticMutationOptions } from '@/lib/optimistic-mutation'
import { patchRecordInCache, restoreRecordFields } from '@/lib/optimistic-record-patch'
import { DETAIL_PREFETCH_GC_MS, DETAIL_PREFETCH_STALE_MS } from '@/lib/intent-prefetch'

/** Invoice list search and sort that the cursor endpoint takes (ADR-0035). */
export type InvoiceCursorFilters = { search?: string }
export type InvoiceCursorParams = InvoiceCursorFilters & { sortField?: string; sortDirection?: 'asc' | 'desc' }

export const invoiceKeys = {
    all: ['invoices'] as const,
    detail: (id: string) => [...invoiceKeys.all, id] as const,
    cursorList: (params: InvoiceCursorParams) => [...invoiceKeys.all, 'cursor-list', params] as const,
    cappedCount: (filters: InvoiceCursorFilters) => [...invoiceKeys.all, 'capped-count', filters] as const,
}

/** Sorts the invoice cursor API approves; customer, status and total keep the unpaged list (ADR-0035 §3). */
export function isInvoiceCursorSort(sortField?: string): boolean {
    return sortField === undefined || sortField === 'invoice_number' || sortField === 'date'
}

/** Infinite invoice list (cap 2,000 rows) with its capped count; idle while the unpaged list is in charge. */
function invoiceCursorEpisodeKey(params: InvoiceCursorParams) {
    return JSON.stringify({
        search: params.search ?? '',
        sortField: params.sortField ?? '',
        sortDirection: params.sortDirection ?? '',
    })
}

export function useInvoiceCursorList(params: InvoiceCursorParams, enabled: boolean) {
    const filters = { search: params.search }
    return useCursorList<Invoice>({
        enabled,
        path: '/api/sales/invoices',
        countPath: '/api/sales/invoices/capped-count',
        semanticEpisodeKey: invoiceCursorEpisodeKey(params),
        listKey: invoiceKeys.cursorList(params),
        countKey: invoiceKeys.cappedCount(filters),
        params,
        countParams: filters,
    })
}

export interface CreateInvoicePayload {
    customerId: string
    vehicleId?: string
    items: {
        catalogItemId?: string
        workshopTaskLineItemId?: string
        description: string
        quantity: number
        unitPrice: number
        taxRate: number
    }[]
    notes?: string
    internalNotes?: string
}

type UpdateInvoiceVariables = {
    id: string
    payload: CreateInvoicePayload
    signal?: AbortSignal
    /** Set only for a note edit. Prices and lines omit it and stay server-confirmed. */
    changedFields?: readonly string[]
}

function invoiceNotePatch(payload: CreateInvoicePayload) {
    return {
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        ...(payload.internalNotes !== undefined ? { internal_notes: payload.internalNotes } : {}),
    }
}

function invoiceNoteFields(payload: CreateInvoicePayload) {
    return [
        payload.notes !== undefined ? 'notes' : '',
        payload.internalNotes !== undefined ? 'internal_notes' : '',
    ].filter((field) => field.length > 0)
}

const updateInvoiceOptimistic = optimisticMutationOptions<unknown, UpdateInvoiceVariables>({
    queryKey: ({ id }) => invoiceKeys.detail(id),
    mutationKey: [...invoiceKeys.all, 'update'],
    entityId: ({ id }) => id,
    shouldOptimistic: isInvoiceUpdateOptimisticEligible,
    apply: (cache, { id, payload }) => patchRecordInCache(cache, id, invoiceNotePatch(payload)),
    revert: (cache, { id, payload }, snapshot) =>
        restoreRecordFields(cache, id, invoiceNoteFields(payload), snapshot),
})

export function useUpdateInvoice() {
    const queryClient = useQueryClient()
    return useMutation({
        ...updateInvoiceOptimistic,
        mutationFn: async ({ id, payload, signal }: UpdateInvoiceVariables) => {
            const response = await fetchWithAuth(`/api/sales/invoices/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal,
            })
            await throwIfSalesResponseNotOk(response, 'Failed to update invoice')
            return response.json() as Promise<Invoice>
        },
        onSuccess: (data, variables) => {
            queryClient.setQueryData(invoiceKeys.detail(data.id), data)
            if (!isInvoiceUpdateOptimisticEligible(variables)) {
                queryClient.invalidateQueries({ queryKey: invoiceKeys.all })
            }
        },
    })
}

export function useFinalizeInvoice() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationKey: [...invoiceKeys.all, 'finalize'],
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

export function useInvoices(options?: { enabled?: boolean }) {
    return useQuery<Invoice[]>({
        queryKey: invoiceKeys.all,
        enabled: options?.enabled ?? true,
        queryFn: async () => {
            const response = await fetchWithAuth('/api/sales/invoices', withScopeContextHeader())
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
