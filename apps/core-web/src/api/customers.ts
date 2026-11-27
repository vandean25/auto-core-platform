import { keepPreviousData, useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
    Customer,
    NormalizedCustomer,
    NormalizedWorkshopOrder,
    NormalizedWorkshopTaskLineItem,
} from './types'
import { throwApiResponseError } from './api-error'
import { fetchWithAuth } from './client'
import type { CursorListQueryParams } from './cursor-list'
import { readOffsetPage } from './cursor-recovery'
import { readScopedOffset, scopedOffsetKey } from './offset-scope-gate'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'
import { isCustomerUpdateOptimisticEligible } from '@/features/interaction/customer-vehicle-update-eligibility'
import { DETAIL_PREFETCH_GC_MS, DETAIL_PREFETCH_STALE_MS } from '@/lib/intent-prefetch'
import { infiniteListQueryOptions } from '@/lib/infinite-list-query'
import { optimisticMutationOptions } from '@/lib/optimistic-mutation'
import { patchRecordInCache, restoreRecordFields } from '@/lib/optimistic-record-patch'

export const customerKeys = {
    all: ['customers'] as const,
    lists: () => [...customerKeys.all, 'list'] as const,
    list: (queryParams?: DataTableQueryParams) => [...customerKeys.lists(), queryParams] as const,
    /** ADR-0035 infinite customer list; its own family so an offset refresh never restarts the cursor chain. */
    cursorLists: () => [...customerKeys.all, 'cursor'] as const,
    cursorList: (params: CursorListQueryParams) =>
        [...customerKeys.cursorLists(), params] as const,
    cappedCount: (filters: CursorListQueryParams) =>
        [...customerKeys.all, 'capped-count', filters] as const,
    detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
    notes: (id: string) => [...customerKeys.detail(id), 'notes'] as const,
    activity: (id: string, types?: readonly string[]) =>
        [...customerKeys.detail(id), 'activity', ...(types && types.length > 0 ? [types.join(',')] : [])] as const,
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

export function useCustomers(
    queryParams?: DataTableQueryParams,
    options?: { enabled?: boolean; offsetEpisodeKey?: string; fresh?: boolean; scopeDigest?: string },
) {
    const scopeDigest = options?.scopeDigest
    return useQuery<CustomerListResponse>({
        queryKey: scopedOffsetKey(customerKeys.list(queryParams), scopeDigest),
        enabled: options?.enabled ?? true,
        ...(options?.fresh ? { staleTime: 0 } : {}),
        placeholderData: keepPreviousData,
        queryFn: () =>
            readScopedOffset(scopeDigest, () =>
                readOffsetPage(options?.offsetEpisodeKey, queryParams?.page, async () => {
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
                }),
            ),
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

export type CustomerActivityType =
    | 'workshop_order'
    | 'sales_order'
    | 'invoice'
    | 'credit_note'
    | 'email'
    | 'consent'
    | 'vehicle_notice'
    | 'loaner_booking'
    | 'customer_note'
    | 'audit'

export type CustomerActivityItem = {
    id: string
    type: CustomerActivityType
    occurred_at: string
    title: string
    ref_id: string
    ref_link: string | null
    summary: Record<string, unknown>
}

export type CustomerActivityResponse = {
    data: CustomerActivityItem[]
    meta: {
        nextCursor: string | null
        hasNextPage: boolean
        limit: number
    }
}

export function useCustomerActivity(customerId: string, types: readonly CustomerActivityType[] = []) {
    return useInfiniteQuery<CustomerActivityResponse>({
        queryKey: customerKeys.activity(customerId, types),
        initialPageParam: undefined as string | undefined,
        enabled: !!customerId,
        ...infiniteListQueryOptions(),
        getNextPageParam: (lastPage) =>
            lastPage?.meta?.hasNextPage ? (lastPage.meta.nextCursor ?? undefined) : undefined,
        queryFn: async ({ pageParam }) => {
            const params = new URLSearchParams()
            params.set('limit', '25')
            if (typeof pageParam === 'string' && pageParam.length > 0) {
                params.set('cursor', pageParam)
            }
            if (types.length > 0) {
                params.set('types', types.join(','))
            }
            const response = await fetchWithAuth(`/api/customers/${customerId}/activity?${params.toString()}`)
            if (!response.ok) {
                await throwApiResponseError(response, 'Failed to fetch customer activity')
            }
            return response.json()
        },
    })
}

export type CustomerNote = {
    id: string
    customer_id: string
    body: string
    pinned: boolean
    author_member_id: string | null
    author_role: string | null
    retention_class: 'OPERATIONAL' | 'CLAIMS_3Y'
    retain_until: string
    legal_hold: boolean
    created_at: string
    updated_at: string
}

export function useCustomerNotes(customerId: string, enabled = true) {
    return useQuery<{ data: CustomerNote[] }>({
        queryKey: customerKeys.notes(customerId),
        enabled: !!customerId && enabled,
        queryFn: async () => {
            const response = await fetchWithAuth(`/api/customers/${customerId}/notes`)
            if (!response.ok) {
                await throwApiResponseError(response, 'Failed to fetch customer notes')
            }
            return response.json()
        },
    })
}

export function useCreateCustomerNote(customerId: string) {
    const queryClient = useQueryClient()
    return useMutation<CustomerNote, Error, { body: string; pinned?: boolean }>({
        mutationKey: ['customer', 'note', 'create'],
        mutationFn: async (payload) => {
            const response = await fetchWithAuth(`/api/customers/${customerId}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            if (!response.ok) {
                await throwApiResponseError(response, 'Failed to create customer note')
            }
            return response.json()
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: customerKeys.notes(customerId) })
            void queryClient.invalidateQueries({ queryKey: customerKeys.detail(customerId) })
        },
    })
}

export function useUpdateCustomerNote(customerId: string) {
    const queryClient = useQueryClient()
    return useMutation<CustomerNote, Error, { noteId: string; body: string }>({
        mutationKey: ['customer', 'note', 'update'],
        mutationFn: async ({ noteId, body }) => {
            const response = await fetchWithAuth(`/api/customers/${customerId}/notes/${noteId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body }),
            })
            if (!response.ok) {
                await throwApiResponseError(response, 'Failed to update customer note')
            }
            return response.json()
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: customerKeys.notes(customerId) })
            void queryClient.invalidateQueries({ queryKey: customerKeys.detail(customerId) })
        },
    })
}

export function usePinCustomerNote(customerId: string) {
    const queryClient = useQueryClient()
    return useMutation<CustomerNote, Error, { noteId: string; pinned: boolean }>({
        mutationKey: ['customer', 'note', 'pin'],
        mutationFn: async ({ noteId, pinned }) => {
            const response = await fetchWithAuth(`/api/customers/${customerId}/notes/${noteId}/pin`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pinned }),
            })
            if (!response.ok) {
                await throwApiResponseError(response, 'Failed to pin customer note')
            }
            return response.json()
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: customerKeys.notes(customerId) })
        },
    })
}

export function useDeleteCustomerNote(customerId: string) {
    const queryClient = useQueryClient()
    return useMutation<{ id: string; deleted: boolean }, Error, { noteId: string }>({
        mutationKey: ['customer', 'note', 'delete'],
        mutationFn: async ({ noteId }) => {
            const response = await fetchWithAuth(`/api/customers/${customerId}/notes/${noteId}`, {
                method: 'DELETE',
            })
            if (!response.ok) {
                await throwApiResponseError(response, 'Failed to delete customer note')
            }
            return response.json()
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: customerKeys.notes(customerId) })
            void queryClient.invalidateQueries({ queryKey: customerKeys.detail(customerId) })
        },
    })
}
