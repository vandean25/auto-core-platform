import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { InventoryItem, InventoryResponse, InventoryTransaction } from './types'
import { throwApiResponseError } from './api-error'
import { fetchWithAuth } from './client'
import { useCursorList } from './cursor-list'
import { DETAIL_PREFETCH_GC_MS, DETAIL_PREFETCH_STALE_MS } from '@/lib/intent-prefetch'

type InventoryApiResponse = {
    data: InventoryItem[]
    meta: {
        total: number
        page: number
        limit?: number
        pageSize?: number
        pageCount?: number
        totalPages?: number
        last_page?: number
    }
}

export type InventoryItemDetail = InventoryItem & {
    cost_price: number
}

type InventoryCursorFilters = { search?: string; location?: string }
type InventoryCursorParams = InventoryCursorFilters & { sortField?: string; sortDirection?: 'asc' | 'desc' }

/** Sorts the API whitelists for cursor paging (ADR-0035); any other sort stays on offset paging. */
const INVENTORY_CURSOR_SORT_FIELDS = new Set(['sku', 'name', 'price'])

export function isInventoryCursorSort(sortField?: string): boolean {
    return !sortField || INVENTORY_CURSOR_SORT_FIELDS.has(sortField)
}

export const inventoryKeys = {
    all: ['inventory'] as const,
    list: (params: { page?: number; pageSize?: number; search?: string; brand?: string; location?: string; sortField?: string; sortDirection?: 'asc' | 'desc' }) => [...inventoryKeys.all, 'list', params] as const,
    cursorList: (params: InventoryCursorParams) => [...inventoryKeys.all, 'cursor-list', params] as const,
    cappedCount: (filters: InventoryCursorFilters) => [...inventoryKeys.all, 'capped-count', filters] as const,
    detail: (itemId: string) => [...inventoryKeys.all, 'detail', itemId] as const,
    history: (itemId: string) => [...inventoryKeys.all, 'history', itemId] as const,
    sku: (sku?: string, itemId?: string) => [...inventoryKeys.all, 'sku', sku ?? '', itemId ?? ''] as const,
}

function normalizeInventoryResponse(payload: InventoryApiResponse): InventoryResponse {
    const pageCount = payload.meta.pageCount ?? payload.meta.totalPages ?? payload.meta.last_page ?? 1
    const limit = payload.meta.pageSize ?? payload.meta.limit ?? 10

    return {
        data: payload.data,
        meta: {
            total: payload.meta.total,
            page: payload.meta.page,
            limit,
            pageCount,
        },
    }
}

export function useInventory(
    params: {
        page?: number
        pageSize?: number
        search?: string
        brand?: string
        location?: string
        sortField?: string
        sortDirection?: 'asc' | 'desc'
    } = {},
    options?: { enabled?: boolean },
) {
    return useQuery<InventoryResponse>({
        queryKey: [...inventoryKeys.list(params)],
        enabled: options?.enabled ?? true,
        queryFn: async () => {
            const searchParams = new URLSearchParams()
            const query = {
                page: params.page,
                pageSize: params.pageSize,
                search: params.search,
                brand: params.brand,
                location: params.location,
                sortField: params.sortField,
                sortDirection: params.sortDirection,
            }
            for (const [key, value] of Object.entries(query)) {
                if (value) searchParams.append(key, String(value))
            }

            const response = await fetchWithAuth(`/api/inventory?${searchParams.toString()}`)
            if (!response.ok) {
                throw new Error('Network response was not ok')
            }
            const payload = (await response.json()) as InventoryApiResponse
            return normalizeInventoryResponse(payload)
        },
    })
}

/** Infinite parts list (cap 2,000 rows) with its capped count; idle while the offset list is in charge. */
export function useInventoryCursorList(params: InventoryCursorParams, enabled: boolean) {
    const filters = { search: params.search, location: params.location }
    return useCursorList<InventoryItem>({
        enabled,
        path: '/api/inventory',
        countPath: '/api/inventory/capped-count',
        listKey: inventoryKeys.cursorList(params),
        countKey: inventoryKeys.cappedCount(filters),
        params,
        countParams: filters,
    })
}

async function parseApiError(response: Response, fallback: string): Promise<Error> {
    try {
        const body = (await response.json()) as { message?: string | string[] }
        const message = Array.isArray(body.message) ? body.message.join(', ') : body.message
        return Object.assign(new Error(message || fallback), { status: response.status })
    } catch {
        return Object.assign(new Error(fallback), { status: response.status })
    }
}

export const INVENTORY_ITEM_DETAIL_STALE_MS = DETAIL_PREFETCH_STALE_MS

export function inventoryItemDetailQueryOptions(itemId: string) {
    return {
        queryKey: inventoryKeys.detail(itemId),
        queryFn: async () => {
            const response = await fetchWithAuth(`/api/inventory/${itemId}`)
            if (!response.ok) {
                throw await parseApiError(response, 'Failed to fetch inventory item')
            }
            return response.json() as Promise<InventoryItemDetail>
        },
        staleTime: INVENTORY_ITEM_DETAIL_STALE_MS,
        gcTime: DETAIL_PREFETCH_GC_MS,
    }
}

export function useInventoryItem(itemId: string) {
    return useQuery<InventoryItemDetail>({
        ...inventoryItemDetailQueryOptions(itemId),
        enabled: !!itemId,
    })
}

export function useInventoryHistory(itemId: string) {
    return useQuery<InventoryTransaction[]>({
        queryKey: inventoryKeys.history(itemId),
        queryFn: async () => {
            const response = await fetchWithAuth(`/api/inventory/${itemId}/history`)
            if (!response.ok) {
                throw new Error('Failed to fetch inventory history')
            }
            return response.json()
        },
        enabled: !!itemId,
    })
}

export function useInventoryItemBySku(sku?: string, itemId?: string) {
    return useQuery<InventoryItem | null>({
        queryKey: inventoryKeys.sku(sku, itemId),
        queryFn: async () => {
            if (!sku) return null
            const searchParams = new URLSearchParams()
            searchParams.append('search', sku)
            searchParams.append('pageSize', '10')
            const response = await fetchWithAuth(`/api/inventory?${searchParams.toString()}`)
            if (!response.ok) {
                throw new Error('Failed to fetch inventory item')
            }
            const payload = normalizeInventoryResponse((await response.json()) as InventoryApiResponse)
            const match = payload.data.find((item) => (itemId ? item.id === itemId : item.sku === sku))
            if (itemId) {
                return match ?? null
            }
            return match ?? payload.data[0] ?? null
        },
        enabled: !!sku,
    })
}

export function useReceiveInventoryStock(itemId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationKey: [...inventoryKeys.all, 'receive-stock'],
        mutationFn: async (data: { locationId: string; quantity: number }) => {
            const response = await fetchWithAuth(`/api/inventory/${itemId}/receive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) {
                throw await parseApiError(response, 'Failed to receive stock')
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
        },
    })
}

export function useAdjustInventoryStock(itemId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationKey: [...inventoryKeys.all, 'adjust-stock'],
        mutationFn: async (data: { locationId: string; quantity: number; reason: string }) => {
            const response = await fetchWithAuth(`/api/inventory/${itemId}/adjust`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) {
                throw await parseApiError(response, 'Failed to adjust stock')
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
        },
    })
}

export function useUpdateInventoryItem(itemId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationKey: [...inventoryKeys.all, 'update'],
        mutationFn: async (data: {
            sku: string
            name: string
            cost_price: number
            retail_price: number
            brandId?: number
        }) => {
            const response = await fetchWithAuth(`/api/inventory/${itemId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) {
                throw await parseApiError(response, 'Failed to update item')
            }
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
        },
    })
}

export type CreateInventoryItemInput = {
    sku: string
    name: string
    cost_price: number
    retail_price: number
    brandId?: number
    revenue_group_id?: number
}

export function useCreateInventoryItem() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationKey: [...inventoryKeys.all, 'create'],
        mutationFn: async (data: CreateInventoryItemInput) => {
            const response = await fetchWithAuth('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) await throwApiResponseError(response, 'Failed to create inventory item')
            return response.json() as Promise<{ id: string }>
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
        },
    })
}

export type BulkPriceFailure = { id: string; sku: string; forbidden: boolean }
export type BulkPriceResult = { total: number; updated: number; failed: BulkPriceFailure[] }

const BULK_PRICE_CONCURRENCY = 5

/** Reads the current record, then edits it, so the server checks role, tenant and item for every part on its own. */
async function adjustRetailPrice(item: Pick<InventoryItem, 'id' | 'sku'>, percent: number): Promise<BulkPriceFailure | null> {
    const failure = (status?: number): BulkPriceFailure => ({ id: item.id, sku: item.sku, forbidden: status === 403 })
    try {
        const read = await fetchWithAuth(`/api/inventory/${item.id}`)
        if (!read.ok) return failure(read.status)
        const detail = (await read.json()) as InventoryItemDetail
        const response = await fetchWithAuth(`/api/inventory/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sku: detail.sku,
                name: detail.name,
                cost_price: detail.cost_price,
                retail_price: Math.round(detail.price * (1 + percent / 100) * 100) / 100,
                ...(detail.brand_id ? { brandId: detail.brand_id } : {}),
            }),
        })
        return response.ok ? null : failure(response.status)
    } catch {
        return failure()
    }
}

/** Bulk price change (ADR-0035 §8): sends exactly the given parts, a few at a time; every rejection is reported per part. */
export function useBulkAdjustInventoryPrices() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationKey: [...inventoryKeys.all, 'bulk-adjust-price'],
        mutationFn: async ({ items, percent }: { items: Pick<InventoryItem, 'id' | 'sku'>[]; percent: number }): Promise<BulkPriceResult> => {
            const failed: BulkPriceFailure[] = []
            for (let start = 0; start < items.length; start += BULK_PRICE_CONCURRENCY) {
                const outcomes = await Promise.all(
                    items.slice(start, start + BULK_PRICE_CONCURRENCY).map((item) => adjustRetailPrice(item, percent)),
                )
                failed.push(...outcomes.filter((outcome): outcome is BulkPriceFailure => outcome !== null))
            }
            return { total: items.length, updated: items.length - failed.length, failed }
        },
        onSuccess: () => {
            // A migrated infinite list is only marked stale ("Liste aktualisieren"), never refetched page by page.
            queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
        },
    })
}
