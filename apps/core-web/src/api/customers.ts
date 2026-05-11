import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
    Customer,
    NormalizedCustomer,
    NormalizedWorkshopOrder,
    NormalizedWorkshopTaskLineItem,
} from './types'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'

export const customerKeys = {
    all: ['customers'] as const,
    list: (queryParams?: DataTableQueryParams) => [...customerKeys.all, 'list', queryParams] as const,
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

export function useCustomer<TCustomer = NormalizedCustomer>(id: string) {
    return useQuery<TCustomer>({
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
        enabled: !!id,
    })
}

export function useCreateCustomer() {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: async (customer: Partial<Customer>) => {
            const response = await fetchWithAuth('/api/customers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(customer),
            })
            if (!response.ok) throw new Error('Failed to create customer')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: customerKeys.all })
        },
    })
}

export function useUpdateCustomer() {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Partial<Customer> }) => {
            const response = await fetchWithAuth(`/api/customers/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) throw new Error('Failed to update customer')
            return response.json()
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: customerKeys.all })
            queryClient.invalidateQueries({ queryKey: customerKeys.detail(data.id) })
        },
    })
}

export function useDeleteCustomer() {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetchWithAuth(`/api/customers/${id}`, {
                method: 'DELETE',
            })
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Failed to delete customer' }))
                throw new Error(error.message || 'Failed to delete customer')
            }
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: customerKeys.all })
        },
    })
}
