import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Brand, BrandType } from './types'

export const brandKeys = {
    all: ['brands'] as const,
    list: (type?: BrandType) => [...brandKeys.all, 'list', { type }] as const,
    detail: (id: number) => [...brandKeys.all, 'detail', id] as const,
}

export function useBrands(type?: BrandType) {
    return useQuery<Brand[]>({
        queryKey: brandKeys.list(type),
        queryFn: async () => {
            const params = new URLSearchParams()
            if (type) params.append('type', type)
            const response = await fetch(`/api/brands?${params.toString()}`)
            if (!response.ok) throw new Error('Failed to fetch brands')
            return response.json()
        },
    })
}

export function useCreateBrand() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: Omit<Brand, 'id' | 'createdAt' | 'updatedAt'>) => {
            const response = await fetch('/api/brands', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) throw new Error('Failed to create brand')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: brandKeys.all })
        },
    })
}

export function useUpdateBrand() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ id, ...data }: Partial<Brand> & { id: number }) => {
            const response = await fetch(`/api/brands/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) throw new Error('Failed to update brand')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: brandKeys.all })
        },
    })
}

export function useDeleteBrand() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (id: number) => {
            const response = await fetch(`/api/brands/${id}`, {
                method: 'DELETE',
            })
            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.message || 'Failed to delete brand')
            }
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: brandKeys.all })
        },
    })
}
