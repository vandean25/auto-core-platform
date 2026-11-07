import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
    Customer,
    NormalizedCustomer,
    NormalizedWorkshopOrder,
    NormalizedWorkshopTaskLineItem,
} from './types'
import { throwApiResponseError } from './api-error'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { isCustomerUpdateOptimisticEligible } from '@/features/interaction/customer-vehicle-update-eligibility'
import { DETAIL_PREFETCH_GC_MS, DETAIL_PREFETCH_STALE_MS } from '@/lib/intent-prefetch'
import { optimisticMutationOptions } from '@/lib/optimistic-mutation'
import { patchRecordInCache, restoreRecordFields } from '@/lib/optimistic-record-patch'

export const customerKeys = {
    all: ['customers'] as const,
    lists: () => [...customerKeys.all, 'list'] as const,
    list: (queryParams?: DataTableQueryParams) => [...customerKeys.lists(), queryParams] as const,
    detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
}

type CustomerListResponse = {
    data: Customer[]
    meta: {
        total: number
        page: number
        pageSize: number
        pageCount: number
    }
}

type RawWorkshopTaskLineItem = Partial<NormalizedWorkshopTaskLineItem> & {
    quantity?: string | number
    qty?: string | number
    unitPrice?: string | number
    unit_price?: string | number
}

type RawWorkshopTask = {
    lineItems?: RawWorkshopTaskLineItem[]
    line_items?: RawWorkshopTaskLineItem[]
}

type RawWorkshopOrder = {
    tasks?: RawWorkshopTask[]
}

function toNumber(value: unknown) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function normalizeWorkshopOrders(workshopOrders: RawWorkshopOrder[] | undefined): NormalizedWorkshopOrder[] {
    return (workshopOrders ?? []).map((order) => ({
        ...order,
        tasks: (order.tasks ?? []).map((task) => ({
            ...task,
            lineItems: (task.lineItems ?? task.line_items ?? []).map((line) => ({
                ...line,
                qty: toNumber(line.qty ?? line.quantity),
                quantity: toNumber(line.quantity ?? line.qty),
                unitPrice: toNumber(line.unitPrice ?? line.unit_price),
            })),
        })),
    })) as NormalizedWorkshopOrder[]
}

export function useCustomers(queryParams?: DataTableQueryParams, options?: { enabled?: boolean }) {
    return useQuery<CustomerListResponse>({
        queryKey: customerKeys.list(queryParams),
        enabled: options?.enabled ?? true,
        queryFn: async () => {
            let url = '/api/customers'
            if (queryParams) {
                const params = new URLSearchParams()
                params.append('page', String(queryParams.page))
                params.append('pageSize', String(queryParams.pageSize))
                if (queryParams.search) params.append('search', queryParams.search)
                if (queryParams.sortField) params.append('sortField', queryParams.sortField)
                if (queryParams.sortDirection) params.append('sortDirection', queryParams.sortDirection)

                const typeFilter = queryParams.filters.find((f) => f.field === 'type')?.value
                if (typeFilter) params.append('type', typeFilter)

                url += `?${params.toString()}`
            }
            
            const response = await fetchWithAuth(url)
            if (!response.ok) throw new Error('Failed to fetch customers')
            return response.json()
        },
    })
}

export const CUSTOMER_DETAIL_STALE_MS = DETAIL_PREFETCH_STALE_MS

export function customerDetailQueryOptions<TCustomer = NormalizedCustomer>(id: string) {
    return {
        queryKey: customerKeys.detail(id),
        queryFn: async () => {
            const response = await fetchWithAuth(`/api/customers/${id}`)
            if (!response.ok) throw new Error('Failed to fetch customer')
            const json = await response.json()
            return {
                ...json,
                workshop_orders: normalizeWorkshopOrders(json.workshop_orders),
            } as TCustomer
        },
        staleTime: CUSTOMER_DETAIL_STALE_MS,
        gcTime: DETAIL_PREFETCH_GC_MS,
    }
}

export function useCustomer<TCustomer = NormalizedCustomer>(id: string) {
    return useQuery<TCustomer>({
        ...customerDetailQueryOptions<TCustomer>(id),
        enabled: !!id,
    })
}

export function useCreateCustomer() {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationKey: [...customerKeys.all, 'create'],
        mutationFn: async (customer: Partial<Customer>) => {
            const response = await fetchWithAuth('/api/customers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(customer),
            })
            if (!response.ok) await throwApiResponseError(response, 'Failed to create customer')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: customerKeys.all })
        },
    })
}

type UpdateCustomerVariables = { id: string; data: Partial<Customer> }

// Descriptive fields only (see the predicate); list pages and the detail are patched together.
const updateCustomerOptimistic = optimisticMutationOptions<unknown, UpdateCustomerVariables>({
    queryKey: ({ id }) => customerKeys.detail(id),
    mutationKey: [...customerKeys.all, 'update'],
    entityId: ({ id }) => id,
    shouldOptimistic: isCustomerUpdateOptimisticEligible,
    apply: (cache, { id, data }) => patchRecordInCache(cache, id, data),
    revert: (cache, { id, data }, snapshot) => restoreRecordFields(cache, id, Object.keys(data), snapshot),
    prefixCaches: [
        {
            queryKey: () => customerKeys.lists(),
            apply: (cache, { id, data }) => patchRecordInCache(cache, id, data),
            revert: (cache, { id, data }, snapshot) => restoreRecordFields(cache, id, Object.keys(data), snapshot),
        },
    ],
})

export function useUpdateCustomer() {
    const queryClient = useQueryClient()

    return useMutation({
        ...updateCustomerOptimistic,
        mutationFn: async ({ id, data }: UpdateCustomerVariables) => {
            const response = await fetchWithAuth(`/api/customers/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) await throwApiResponseError(response, 'Failed to update customer')
            return response.json()
        },
        // An optimistic edit is reconciled by the helper on settle; a server-confirmed one (e-mail, tax id, type) refetches here.
        onSuccess: (_data, variables) => {
            if (!isCustomerUpdateOptimisticEligible(variables)) {
                queryClient.invalidateQueries({ queryKey: customerKeys.all })
            }
        },
    })
}

export function useDeleteCustomer() {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationKey: [...customerKeys.all, 'delete'],
        mutationFn: async (id: string) => {
            const response = await fetchWithAuth(`/api/customers/${id}`, {
                method: 'DELETE',
            })
            if (!response.ok) {
                const payload = (await response.json().catch(() => ({}))) as { message?: string }
                throw Object.assign(new Error(payload.message || 'Failed to delete customer'), { data: payload })
            }
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: customerKeys.all })
        },
    })
}
