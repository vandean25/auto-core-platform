import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'

export type LocationType = 'warehouse' | 'aisle' | 'shelf' | 'bin' | 'customer_storage' | 'staging_tote'

export interface StorageLocation {
    id: string
    name: string
    code: string
    type: LocationType
    parent_id?: string | null
    parent?: StorageLocation
    children?: StorageLocation[]
    _count?: {
        children: number
        stocks: number
    }
}

export const locationKeys = {
    all: ['locations'] as const,
    tree: () => [...locationKeys.all, 'tree'] as const,
    list: () => [...locationKeys.all, 'list'] as const,
}

export function useLocationTree() {
    return useQuery<StorageLocation[]>({
        queryKey: locationKeys.tree(),
        queryFn: async () => {
            const response = await fetchWithAuth('/api/inventory/locations/tree')
            if (!response.ok) throw new Error('Failed to fetch location tree')
            return response.json()
        },
    })
}

export function useLocations(options?: { enabled?: boolean }) {
    return useQuery<StorageLocation[]>({
        queryKey: locationKeys.list(),
        queryFn: async () => {
            const response = await fetchWithAuth('/api/inventory/locations')
            if (!response.ok) throw new Error('Failed to fetch locations')
            return response.json()
        },
        enabled: options?.enabled ?? true,
    })
}

export function useCreateLocation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: { name: string; code: string; type: LocationType; parentId?: string }) => {
            const response = await fetchWithAuth('/api/inventory/locations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.message || 'Failed to create location')
            }
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: locationKeys.all })
        },
    })
}

export function useDeleteLocation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (id: string) => {
            const response = await fetchWithAuth(`/api/inventory/locations/${id}`, {
                method: 'DELETE',
            })
            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.message || 'Failed to delete location')
            }
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: locationKeys.all })
        },
    })
}
