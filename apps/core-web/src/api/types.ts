import type { components } from './generated/openapi'

type OpenApiSchemas = components['schemas']

export type InventoryStatus = OpenApiSchemas['InventoryItemResponseDto']['status']

export type TransactionType =
    | 'PURCHASE_RECEIPT'
    | 'SALE_ISSUE'
    | 'ADJUSTMENT'
    | 'TRANSFER_IN'
    | 'TRANSFER_OUT'
    | 'INITIAL_BALANCE'

export type InventoryItem = OpenApiSchemas['InventoryItemResponseDto'] & {
    category?: string
}

export interface InventoryResponse {
    data: InventoryItem[]
    meta: {
        total: number
        page: number
        limit: number
        pageCount: number
    }
}

export type InventoryTransaction = Omit<
    OpenApiSchemas['InventoryTransactionResponseDto'],
    'type'
> & {
    type: TransactionType
}

export type Vendor = OpenApiSchemas['VendorResponseDto']

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
    engine_code?: string
    vin?: string
    plate?: string
}

export type InvoiceStatus = 'DRAFT' | 'FINALIZED' | 'ISSUED' | 'PAID' | 'CANCELLED'

export type DiscountType = 'PERCENTAGE' | 'FLAT_AMOUNT'

export interface InvoiceItem {
    id: string
    catalog_item_id?: string
    description: string
    quantity: number
    unit_price: number
    tax_rate: number
    line_discount_type?: DiscountType | null
    line_discount_value?: number | string | null
    line_total?: number | string | null
    revenue_group_name?: string | null
}

export interface Invoice {
    id: string
    invoice_number: string | null
    status: InvoiceStatus
    customer_id: string
    customer: Customer
    vehicle_id?: string
    vehicle?: Vehicle
    sales_order_id?: string | null
    workshop_order_id?: string | null
    date: string
    due_date: string
    total_net: string
    total_tax: string
    total_gross: string
    global_discount_type?: DiscountType | null
    global_discount_value?: number | string | null
    notes?: string
    internal_notes?: string
    pdf_generated_at?: string | null
    pdf_generation_error?: string | null
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
    taxRate?: number
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
    purchase_order_item?: {
        id: string
        purchase_order_id: string
        purchase_order: {
            id: string
            order_number: string
        }
    }
    description: string
    quantity: string
    unit_price: string
    tax_rate: number
    line_total: string
}

export interface Brand {
    id: number
    name: string
    isVehicleMake: boolean
    isPartManufacturer: boolean
    logoUrl?: string | null
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

export type WorkshopOrderStatus = OpenApiSchemas['WorkshopOrderResponseDto']['status']
export type WorkshopTaskStatus = OpenApiSchemas['WorkshopTaskResponseDto']['status']
export type WorkshopLineItemType = OpenApiSchemas['WorkshopTaskLineItemResponseDto']['type']

export type WorkshopTaskLineItem = OpenApiSchemas['WorkshopTaskLineItemResponseDto']

export interface NormalizedWorkshopTaskLineItem {
    id?: string
    type?: WorkshopLineItemType
    itemNo?: string
    description?: string
    qty: number
    unitPrice: number
    quantity: number
}

export type WorkshopTask = Omit<
    OpenApiSchemas['WorkshopTaskResponseDto'],
    'lineItems' | 'createdAt' | 'updatedAt'
> & {
    lineItems?: WorkshopTaskLineItem[]
    createdAt?: string
    updatedAt?: string
}

export type WorkshopOrder = Omit<
    OpenApiSchemas['WorkshopOrderResponseDto'],
    'tasks' | 'invoice' | 'updatedAt'
> & {
    mechanic_id?: string | null
    mechanicId?: string | null
    bay_id?: string | null
    bayId?: string | null
    tasks?: WorkshopTask[]
    invoice?: OpenApiSchemas['WorkshopInvoiceSummaryDto'] | null
    updatedAt?: string
}

export interface WorkshopPickLineItemPayload {
    workshopTaskLineItemId: string
    quantity: number
    sourceLocationId?: string
}

export interface WorkshopPickPartsPayload {
    destinationLocationId: string
    items: WorkshopPickLineItemPayload[]
}

export interface WorkshopPickLineAllocation {
    sourceLocationId: string
    quantity: number
    referenceId: string
}

export interface WorkshopPickMovedLine {
    workshopTaskLineItemId: string
    movedQuantity: number
    allocations: WorkshopPickLineAllocation[]
}

export interface WorkshopPickPartsResponse {
    id: string
    stagingLocationId: string
    transferGroupId: string
    movedLines: WorkshopPickMovedLine[]
}

export interface NormalizedWorkshopTask extends Omit<WorkshopTask, 'lineItems'> {
    lineItems?: NormalizedWorkshopTaskLineItem[]
}

export interface NormalizedWorkshopOrder extends Omit<WorkshopOrder, 'tasks'> {
    tasks?: NormalizedWorkshopTask[]
}

export interface NormalizedCustomer extends Customer {
    workshop_orders?: NormalizedWorkshopOrder[]
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

export interface LaborOperationSearchItem {
    id: string
    code: string
    description: string
    standardAw: number
    hourlyRate: number
    categoryName: string | null
}

export interface LaborOperationSearchResponse {
    data: LaborOperationSearchItem[]
    meta: {
        total: number
        limit: number
    }
}

export interface LaborCategory {
    id: string
    name: string
    description: string | null
    sort_order: number
    parent_id: string | null
    is_active: boolean
    default_hourly_rate: number | null
    children?: LaborCategory[]
}

export interface LaborFitmentItem {
    id: string
    make: string
    model: string
    yearFrom: number | null
    yearTo: number | null
    engineCode: string | null
}

export interface LaborOperationDetail {
    id: string
    code: string
    description: string
    standardAw: number
    hourlyRate: number
    internalCost: number | null
    categoryId: string | null
    category: { id: string; name: string } | null
    categoryName?: string
    isActive: boolean
    fitments: LaborFitmentItem[]
    createdAt: string
    updatedAt: string
}

export interface CatalogPartSearchItem {
    id: string
    supplierPartNumber: string
    oemNumber: string | null
    description: string
    brand: string
    quantityOnHand: number
    binLocation: string | null
    costPrice: number | null
    retailPrice: number | null
}

export interface CatalogSearchResponse {
    labor: LaborOperationSearchItem[]
    parts: CatalogPartSearchItem[]
    meta: {
        laborCount: number
        partCount: number
        limit: number
    }
}

export interface CreateWorkshopOrderPayload {
    customerId?: string
    vehicleId: string
    odometer: number
    fuelLevel: number
    reportedIssue?: string
    notes?: string
    purpose?: 'CUSTOMER_REPAIR' | 'STOCK_PREP'
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
