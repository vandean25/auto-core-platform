import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'

const VENDORS_API = '/api/vendors'

export function useVendors(queryParams?: string) {
    return useQuery<any>({
        queryKey: ['vendors', queryParams],
        queryFn: async () => {
            let url = VENDORS_API
            if (queryParams) {
                if (queryParams.startsWith('{')) {
                    url += `?params=${encodeURIComponent(queryParams)}`
                }
            }
            const res = await fetchWithAuth(url)
            if (!res.ok) throw new Error('Failed to fetch vendors')
            return res.json()
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
            const res = await fetchWithAuth(VENDORS_API, {
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
