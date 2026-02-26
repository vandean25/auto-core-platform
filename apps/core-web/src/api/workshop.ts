import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { 
    WorkshopSearchResponse, 
    CreateWorkshopOrderPayload, 
    WorkshopOrder, 
    RegisterIntakePayload,
    WorkshopOrdersResponse
} from './types'

export const useWorkshopSearch = (query: string) => {
    return useQuery<WorkshopSearchResponse>({
        queryKey: ['workshop', 'search', query],
        queryFn: async () => {
            if (!query || query.length < 2) return { data: { vehicles: [], customers: [] }, meta: { total: 0, page: 1, limit: 0, totalPages: 0 } }
            const response = await fetchWithAuth(`/api/workshop/search?q=${encodeURIComponent(query)}`)
            if (!response.ok) throw new Error('Failed to search')
            return response.json()
        },
        enabled: query.length >= 2,
    })
}

export const useCreateWorkshopOrder = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: CreateWorkshopOrderPayload) => {
            const response = await fetchWithAuth('/api/workshop/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            if (!response.ok) throw new Error('Failed to create workshop order')
            return response.json() as Promise<WorkshopOrder>
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workshop'] })
        }
    })
}

export const useRegisterIntake = () => {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: RegisterIntakePayload) => {
            const response = await fetchWithAuth('/api/workshop/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            if (!response.ok) throw new Error('Failed to register intake')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workshop'] })
        }
    })
}

export const useWorkshopOrders = (queryParams?: string) => {
    return useQuery<WorkshopOrdersResponse>({
        queryKey: ['workshop', 'orders', queryParams],
        queryFn: async () => {
            const url = queryParams ? `/api/workshop?params=${encodeURIComponent(queryParams)}` : '/api/workshop'
            const response = await fetchWithAuth(url)
            if (!response.ok) throw new Error('Failed to fetch workshop orders')
            return response.json()
        }
    })
}
