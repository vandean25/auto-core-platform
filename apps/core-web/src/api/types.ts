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

export type CustomerType = 'PRIVATE' | 'COMPANY'

export interface Customer {
    id: string
    type: CustomerType
    company_name?: string
    first_name: string
    last_name: string
    email: string
    phone?: string
    vat_id?: string
    address_street?: string
    address_city?: string
    address_zip?: string
    address_country?: string
}

export type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'INVOICED'

export interface SalesOrderItem {
    id: string
    catalog_item_id?: string
    catalog_item?: {
        sku: string
        name: string
    }
    description: string
    quantity: string
    unit_price: string
    total: string
    tax_rate: number
}

export interface SalesOrder {
    id: string
    order_number: string
    customer_id: string
    customer: Customer
    vehicle_id?: string
    vehicle?: Vehicle
    status: SalesOrderStatus
    total_amount: string
    notes?: string
    items: SalesOrderItem[]
    invoice?: Invoice
    createdAt: string
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

export interface Brand {
    id: number
    name: string
    isVehicleMake: boolean
    isPartManufacturer: boolean
    logoUrl?: string
    createdAt: string
    updatedAt: string
}

export interface RevenueGroup {
    id: number
    name: string
    tax_rate: number
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

export type WorkshopOrderStatus = 'SCHEDULED' | 'INTAKE' | 'IN_PROGRESS' | 'COMPLETED'
export type WorkshopTaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'DONE'
export type WorkshopLineItemType = 'LABOR' | 'PART'

export interface WorkshopTaskLineItem {
    id: string
    type: WorkshopLineItemType
    itemNo: string
    description: string
    qty: number
    unitPrice: number
}

export interface WorkshopTask {
    id: string
    title: string
    status: WorkshopTaskStatus
    done: boolean
    mechanicNotes?: string
    lineItems?: WorkshopTaskLineItem[]
}

export interface WorkshopOrder {
    id: string
    status: WorkshopOrderStatus
    customer_id: string
    customer: Customer
    vehicle_id: string
    vehicle: Vehicle
    odometer: number
    fuel_level: number
    reported_issue?: string
    reportedIssue?: string
    notes?: string
    tasks?: WorkshopTask[]
    invoice?: Invoice | null
    createdAt: string
}

export interface WorkshopSearchResponse {
    data: {
        vehicles: (Vehicle & { customer: Customer | null })[]
        customers: (Customer & { vehicles: Vehicle[] })[]
    }
    meta: {
        total: number
        page: number
        limit: number
        totalPages: number
    }
}

export interface CreateWorkshopOrderPayload {
    customerId: string
    vehicleId: string
    odometer: number
    fuelLevel: number
    reportedIssue?: string
    notes?: string
}

export interface RegisterIntakePayload {
    vin: string
    plate: string
    make: string
    model: string
    year: number
    customerId?: string
    firstName?: string
    lastName?: string
    email?: string
    phone?: string
}
