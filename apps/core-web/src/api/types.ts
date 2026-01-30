export type InventoryStatus = 'IN_STOCK' | 'OUT_OF_STOCK' | 'SUPERSEDED'

export type TransactionType =
    | 'PURCHASE_RECEIPT'
    | 'SALE_ISSUE'
    | 'ADJUSTMENT'
    | 'TRANSFER_IN'
    | 'TRANSFER_OUT'
    | 'INITIAL_BALANCE'

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

export interface InventoryTransaction {
    id: string
    quantity: string
    type: TransactionType
    reference_id: string | null
    cost_basis: string | null
    createdAt: string
    item: {
        sku: string
        name: string
    }
    location: {
        name: string
    }
}

export interface Vendor {
    id: string
    name: string
    email: string
    account_number: string
    supported_brands: string[]
}

export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'COMPLETED'

export interface PurchaseOrderItem {
    id: string
    catalog_item_id: string
    catalog_item: {
        sku: string
        name: string
        brand?: string
    }
    quantity: number
    quantity_received: number
    unit_cost: string // decimal usually comes as string from API unless parsed
}

export interface PurchaseOrder {
    id: string
    vendor_id: string
    vendor: Vendor
    status: PurchaseOrderStatus
    order_number: string
    items: PurchaseOrderItem[]
    createdAt: string
}
