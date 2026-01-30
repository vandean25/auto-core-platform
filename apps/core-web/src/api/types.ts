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
    brand_id?: number
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
    supportedBrands: Brand[]
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

export interface Customer {
    id: string
    name: string
    email: string
    phone?: string
    address?: string
}

export interface Vehicle {
    id: string
    make: string
    model: string
    year: number
    vin?: string
    plate?: string
}

export type InvoiceStatus = 'DRAFT' | 'FINALIZED' | 'PAID' | 'CANCELLED'

export interface InvoiceItem {
    id: string
    catalog_item_id?: string
    description: string
    quantity: number
    unit_price: number
    tax_rate: number
}

export interface Invoice {
    id: string
    invoice_number: string | null
    status: InvoiceStatus
    customer_id: string
    customer: Customer
    vehicle_id?: string
    vehicle?: Vehicle
    date: string
    due_date: string
    total_net: string
    total_tax: string
    total_gross: string
    notes?: string
    internal_notes?: string
    items: InvoiceItem[]
}

export interface UnbilledReceiptItem {
    purchaseOrderItemId: string
    purchaseOrderId: string
    purchaseOrderNumber: string
    catalogItemId: string
    catalogItemName: string
    quantityReceived: number
    quantityInvoiced: number
    quantityPending: number
    lastUnitCost: number
}

export interface CreatePurchaseInvoiceDto {
    vendorId: string
    vendorInvoiceNumber: string
    invoiceDate: string
    dueDate: string
    items: PurchaseInvoiceLineDto[]
}

export interface PurchaseInvoiceLineDto {
    purchaseOrderItemId?: string
    description: string
    quantity: number
    unitPrice: number
}

export type PurchaseInvoiceStatus = 'DRAFT' | 'POSTED' | 'PAID'

export interface PurchaseInvoice {
    id: string
    vendor_id: string
    vendor: Vendor
    vendor_invoice_number: string
    status: PurchaseInvoiceStatus
    invoice_date: string
    due_date: string
    total_amount: string
    lines: PurchaseInvoiceLine[]
    createdAt: string
}

export interface PurchaseInvoiceLine {
    id: string
    purchase_invoice_id: string
    purchase_order_item_id?: string
    description: string
    quantity: string
    unit_price: string
    line_total: string
}

export type BrandType = 'VEHICLE_MAKE' | 'PART_MANUFACTURER'

export interface Brand {
    id: number
    name: string
    type: BrandType
    logoUrl?: string
    createdAt: string
    updatedAt: string
}

export interface RevenueGroup {
    id: number
    name: string
    tax_rate: string
    account_number: string
    is_default: boolean
}

export interface FinanceSettings {
    id: number
    fiscal_year_start_month: number
    lock_date: string | null
    next_invoice_number: number
    invoice_prefix: string
}

export interface RevenueAnalytics {
    data: {
        name: string
        value: number
        color: string
    }[]
    total: number
    period: string
}
