import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Customer } from './types'
import { fetchWithAuth } from './client'

export const customerKeys = {
    all: ['customers'] as const,
    list: (search?: string) => [...customerKeys.all, 'list', search] as const,
    detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
}

export function useCustomers(queryParams?: string) {
    return useQuery<any>({ // Using any for now to handle data/meta structure or array
        queryKey: customerKeys.list(queryParams),
        queryFn: async () => {
            let url = '/api/customers'
            if (queryParams) {
                // Check if queryParams is just a search string (legacy) or a params JSON
                if (queryParams.startsWith('{')) {
                    url += `?params=${encodeURIComponent(queryParams)}`
                } else {
                    const params = new URLSearchParams()
                    params.append('search', queryParams)
                    url += `?${params.toString()}`
                }
            }
            
            const response = await fetchWithAuth(url)
            if (!response.ok) throw new Error('Failed to fetch customers')
            return response.json()
        },
    })
}

export function useCustomer(id: string) {
    return useQuery<Customer>({
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
            if (!response.ok) throw new Error('Failed to delete customer')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: customerKeys.all })
        },
    })
}
