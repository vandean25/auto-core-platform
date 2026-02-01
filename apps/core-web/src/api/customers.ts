import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Customer } from './types'

export const customerKeys = {
    all: ['customers'] as const,
    list: (search?: string) => [...customerKeys.all, 'list', search] as const,
    detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
}

export function useCustomers(search?: string) {
    return useQuery<Customer[]>({
        queryKey: customerKeys.list(search),
        queryFn: async () => {
            const params = new URLSearchParams()
            if (search) params.append('search', search)
            
            const response = await fetch(`/api/customers?${params.toString()}`)
            if (!response.ok) throw new Error('Failed to fetch customers')
            return response.json()
        },
    })
}

export function useCustomer(id: string) {
    return useQuery<Customer>({
        queryKey: customerKeys.detail(id),
        queryFn: async () => {
            const response = await fetch(`/api/customers/${id}`)
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
            const response = await fetch('/api/customers', {
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
            const response = await fetch(`/api/customers/${id}`, {
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
            const response = await fetch(`/api/customers/${id}`, {
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