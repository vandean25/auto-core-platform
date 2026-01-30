import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { PurchaseOrder } from './types'

const PO_API = '/api/purchase-orders'

export function usePurchaseOrders() {
    return useQuery({
        queryKey: ['purchase-orders'],
        queryFn: async () => {
            const res = await fetch(PO_API)
            if (!res.ok) throw new Error('Failed to fetch purchase orders')
            // The API currently returns array or { data, meta }? Controller returns existing service result which is usually just the object or array.
            // Vendor service findAll returns array. PO service create returns object.
            // Assuming we will add a findAll endpoint to PO controller properly later, but for now let's assume strictly what we agreed.
            // Wait, I missed adding a specific "List POs" endpoint in the plan! The plan said "PurchaseOrderList.tsx: List of POs".
            // I need to add @Get() to PurchaseController. 
            // For now I'll stub this hook but I must fix backend.
            return res.json() as Promise<PurchaseOrder[]> // Assumption
        },
    })
}

export function useCreatePO() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: { vendorId: string; items: { catalogItemId: string; quantity: number; unitCost: number }[] }) => {
            const res = await fetch(PO_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) throw new Error('Failed to create PO')
            return res.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
        },
    })
}

export function usePurchaseOrder(id: string) {
    return useQuery({
        queryKey: ['purchase-orders', id],
        queryFn: async () => {
            // The endpoint isn't explicitly defined in my previous view_file of controller, but usually we need one.
            // I see `receiveItems` uses `:id/receive`.
            // I should probably add `@Get(':id')` to backend too.
            const res = await fetch(`${PO_API}/${id}`)
            if (!res.ok) throw new Error('Failed to fetch PO')
            return res.json() as Promise<PurchaseOrder>
        },
        enabled: !!id,
    })
}

export function useReceiveGoods() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ orderId, items }: { orderId: string; items: { itemId: string; quantity: number }[] }) => {
            const res = await fetch(`${PO_API}/${orderId}/receive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
            })
            if (!res.ok) throw new Error('Failed to receive goods')
            return res.json()
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders', variables.orderId] })
            queryClient.invalidateQueries({ queryKey: ['inventory'] }) // Update stock lists
        },
    })
}
