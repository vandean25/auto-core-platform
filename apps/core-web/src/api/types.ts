export type InventoryStatus = 'IN_STOCK' | 'OUT_OF_STOCK' | 'SUPERSEDED'

export interface InventoryItem {
    id: string
    sku: string
    name: string
    brand: string
    price: number
    status: InventoryStatus
    quantity_available: number
    category?: string
    warehouse_location?: string
}

export interface InventoryResponse {
    data: InventoryItem[]
    meta: {
        total: number
        page: number
        limit: number
        totalPages: number
    }
}
