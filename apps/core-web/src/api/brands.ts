import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import type { Brand } from './types'
import { fetchWithAuth } from './client'

const BrandSchema = z.object({
    id: z.number(),
    name: z.string(),
    isVehicleMake: z.boolean(),
    isPartManufacturer: z.boolean(),
    logoUrl: z.string().optional().nullable(),
    createdAt: z.string().optional().nullable(),
    updatedAt: z.string().optional().nullable(),
})

const PaginatedBrandsSchema = z.object({
    data: z.array(BrandSchema),
    meta: z.object({
        total: z.number(),
        page: z.number(),
        limit: z.number(),
        totalPages: z.number(),
    }),
})

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

            const raw = await response.json()
            const result = PaginatedBrandsSchema.safeParse(raw)

            if (!result.success) {
                console.error('API structure mismatch for brands:', result.error)
                return []
            }

            return result.data.data as unknown as Brand[]
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
