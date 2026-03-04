import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Customer } from './types'
import { fetchWithAuth } from './client'
import type { DataTableQueryParams } from '@/hooks/useDataTableQuery'

export const customerKeys = {
    all: ['customers'] as const,
    list: (queryParams?: DataTableQueryParams) => [...customerKeys.all, 'list', queryParams] as const,
    detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
}

export function useCustomers(queryParams?: DataTableQueryParams) {
    return useQuery<any>({ // Using any for now to handle data/meta structure or array
        queryKey: customerKeys.list(queryParams),
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

export function useCustomer<TCustomer = Customer>(id: string) {
    return useQuery<TCustomer>({
        queryKey: customerKeys.detail(id),
        queryFn: async () => {
            const response = await fetchWithAuth(`/api/customers/${id}`)
            if (!response.ok) throw new Error('Failed to fetch customer')
            return response.json()
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
