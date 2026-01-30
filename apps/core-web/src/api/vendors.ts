import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Vendor } from './types'

const VENDORS_API = '/api/vendors'

export function useVendors() {
    return useQuery({
        queryKey: ['vendors'],
        queryFn: async () => {
            const res = await fetch(VENDORS_API)
            if (!res.ok) throw new Error('Failed to fetch vendors')
            return res.json() as Promise<Vendor[]>
        },
    })
}

export function useCreateVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: {
            name: string;
            email: string;
            account_number: string;
            brandIds: number[];
        }) => {
            const res = await fetch(VENDORS_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: data.name,
                    email: data.email,
                    accountNumber: data.account_number,
                    brandIds: data.brandIds
                }),
            })
            if (!res.ok) throw new Error('Failed to create vendor')
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vendors'] })
        },
    })
}