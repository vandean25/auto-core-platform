import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FinanceSettings, RevenueGroup, RevenueAnalytics } from './types'

export const financeKeys = {
    all: ['finance'] as const,
    settings: () => [...financeKeys.all, 'settings'] as const,
    revenueGroups: () => [...financeKeys.all, 'revenue-groups'] as const,
    analytics: (type: string) => [...financeKeys.all, 'analytics', type] as const,
}

export function useFinanceSettings() {
    return useQuery<FinanceSettings>({
        queryKey: financeKeys.settings(),
        queryFn: async () => {
            const response = await fetch('/api/finance/settings')
            if (!response.ok) throw new Error('Failed to fetch finance settings')
            return response.json()
        },
    })
}

export function useUpdateFinanceSettings() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: Partial<FinanceSettings>) => {
            const response = await fetch('/api/finance/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) throw new Error('Failed to update finance settings')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: financeKeys.settings() })
        },
    })
}

export function useRevenueGroups() {
    return useQuery<RevenueGroup[]>({
        queryKey: financeKeys.revenueGroups(),
        queryFn: async () => {
            const response = await fetch('/api/finance/revenue-groups')
            if (!response.ok) throw new Error('Failed to fetch revenue groups')
            return response.json()
        },
    })
}

export function useCreateRevenueGroup() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: Omit<RevenueGroup, 'id'>) => {
            const response = await fetch('/api/finance/revenue-groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!response.ok) throw new Error('Failed to create revenue group')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: financeKeys.revenueGroups() })
        },
    })
}

export function useRevenueAnalytics() {
    return useQuery<RevenueAnalytics>({
        queryKey: financeKeys.analytics('revenue-by-group'),
        queryFn: async () => {
            const response = await fetch('/api/finance/analytics/revenue-by-group')
            if (!response.ok) throw new Error('Failed to fetch revenue analytics')
            return response.json()
        },
    })
}
