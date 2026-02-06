import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Brand } from './types'
import { fetchWithAuth } from './client'

export const brandKeys = {
    all: ['brands'] as const,
    list: (filters?: { isVehicleMake?: boolean; isPartManufacturer?: boolean }) => [...brandKeys.all, 'list', filters] as const,
    detail: (id: number) => [...brandKeys.all, 'detail', id] as const,
}

export function useBrands(filters?: { isVehicleMake?: boolean; isPartManufacturer?: boolean }) {
    return useQuery<Brand[]>({
        queryKey: brandKeys.list(filters),
        queryFn: async () => {
            const params = new URLSearchParams()
            if (filters?.isVehicleMake !== undefined) params.append('isVehicleMake', filters.isVehicleMake.toString())
            if (filters?.isPartManufacturer !== undefined) params.append('isPartManufacturer', filters.isPartManufacturer.toString())
            
            const response = await fetchWithAuth(`/api/brands?${params.toString()}`)
            if (!response.ok) throw new Error('Failed to fetch brands')
            return response.json()
        },
    })
}

export function useCreateBrand() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: Omit<Brand, 'id' | 'createdAt' | 'updatedAt'>) => {
            const response = await fetchWithAuth('/api/brands', {
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
            const response = await fetchWithAuth(`/api/brands/${id}`, {
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
            const response = await fetchWithAuth(`/api/brands/${id}`, {
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
