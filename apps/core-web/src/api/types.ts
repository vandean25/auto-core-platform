import type { components } from './generated/openapi'

type OpenApiSchemas = components['schemas']

export type InventoryStatus = OpenApiSchemas['InventoryItemResponseDto']['status']

export type InventoryItem = OpenApiSchemas['InventoryItemResponseDto'] & {
    category?: string
}

export type InventoryTransaction = OpenApiSchemas['InventoryTransactionResponseDto']
export type TransactionType = InventoryTransaction['type']

/** Client-normalized inventory list. The query hook maps API `pageSize` onto `limit`. */
export interface InventoryResponse {
    data: InventoryItem[]
    meta: {
        total: number
        page: number
        limit: number
        pageCount: number
    }
}

export type Vendor = OpenApiSchemas['VendorResponseDto']
export type Brand = OpenApiSchemas['BrandResponseDto']
export type Customer = OpenApiSchemas['CustomerResponseDto']
export type CustomerType = Customer['type']
export type Vehicle = OpenApiSchemas['VehicleResponseDto']

export type SalesOrder = OpenApiSchemas['SalesOrderResponseDto']
export type SalesOrderStatus = SalesOrder['status']
export type SalesOrderItem = SalesOrder['items'][number]

export type Invoice = OpenApiSchemas['InvoiceResponseDto']
export type InvoiceStatus = Invoice['status']
export type InvoiceItem = Invoice['items'][number]
export type DiscountType = NonNullable<Invoice['global_discount_type']>

export type PurchaseOrder = OpenApiSchemas['PurchaseOrderResponseDto']
export type PurchaseOrderStatus = PurchaseOrder['status']
export type PurchaseOrderItem = PurchaseOrder['items'][number]

export type PurchaseInvoice = OpenApiSchemas['PurchaseInvoiceResponseDto']
export type PurchaseInvoiceStatus = PurchaseInvoice['status']
export type PurchaseInvoiceLine = PurchaseInvoice['lines'][number]
export type CreatePurchaseInvoiceDto = OpenApiSchemas['CreatePurchaseInvoiceDto']
export type PurchaseInvoiceLineDto = CreatePurchaseInvoiceDto['items'][number]
export type UnbilledReceiptItem = OpenApiSchemas['UnbilledReceiptItemDto']

export type FinanceSettings = OpenApiSchemas['FinanceSettingsResponseDto']
export type RevenueGroup = OpenApiSchemas['RevenueGroupResponseDto']
export type RevenueAnalytics = OpenApiSchemas['RevenueAnalyticsResponseDto']

export type WorkshopOrderStatus = OpenApiSchemas['WorkshopOrderResponseDto']['status']
export type WorkshopTaskStatus = OpenApiSchemas['WorkshopTaskResponseDto']['status']
export type WorkshopLineItemType = OpenApiSchemas['WorkshopTaskLineItemResponseDto']['type']
export type WorkshopTaskLineItem = OpenApiSchemas['WorkshopTaskLineItemResponseDto']

/** Client-normalized line item: OpenAPI cannot express snake/camel qty aliases. */
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

export type WorkshopPickLineItemPayload =
    OpenApiSchemas['PickWorkshopPartsLineDto']
export type WorkshopPickPartsPayload = OpenApiSchemas['PickWorkshopPartsDto']
export type WorkshopPickLineAllocation =
    OpenApiSchemas['PickWorkshopPartAllocationResponseDto']
export type WorkshopPickMovedLine =
    OpenApiSchemas['PickWorkshopPartMovedLineResponseDto']
export type WorkshopPickPartsResponse =
    OpenApiSchemas['PickWorkshopPartsResponseDto']

export interface NormalizedWorkshopTask extends Omit<WorkshopTask, 'lineItems'> {
    lineItems?: NormalizedWorkshopTaskLineItem[]
}

export interface NormalizedWorkshopOrder extends Omit<WorkshopOrder, 'tasks'> {
    tasks?: NormalizedWorkshopTask[]
}

export interface NormalizedCustomer extends Customer {
    workshop_orders?: NormalizedWorkshopOrder[]
}

export type WorkshopSearchResponse = OpenApiSchemas['WorkshopSearchResponseDto']

export type LaborOperationSearchItem = OpenApiSchemas['LaborOperationSearchItemDto']
export type LaborOperationSearchResponse =
    OpenApiSchemas['LaborOperationSearchResponseDto']
export type LaborCategory = OpenApiSchemas['LaborCategoryResponseDto']
export type LaborFitmentItem = OpenApiSchemas['LaborOperationFitmentResponseDto']
export type LaborOperationDetail = OpenApiSchemas['LaborOperationResponseDto']

export type CatalogPartSearchItem = OpenApiSchemas['CatalogPartSearchItemDto']
export type CatalogSearchResponse = OpenApiSchemas['CatalogSearchResponseDto']

export type CatalogSearchConcern = 'PARTS' | 'LABOR'
export type CatalogSearchSource = 'AUTO' | 'OEM' | 'AFTERMARKET'
export type CatalogExternalSearchResponse = OpenApiSchemas['CatalogExternalSearchResponseDto']
export type CatalogExternalPartsItem = OpenApiSchemas['CatalogExternalPartsItemDto']
export type CatalogExternalLaborItem = OpenApiSchemas['CatalogExternalLaborItemDto']
export type CatalogAssemblyGroupsResponse = OpenApiSchemas['CatalogAssemblyGroupsResponseDto']
export type CatalogAssemblyGroupNode = OpenApiSchemas['CatalogAssemblyGroupNodeDto']
export type CatalogProviderSettings = OpenApiSchemas['CatalogProviderSettingsResponseDto']
export type CatalogProviderOemConcern = OpenApiSchemas['CatalogProviderOemConcernResponseDto']

export type CreateWorkshopOrderPayload = OpenApiSchemas['CreateWorkshopOrderDto']
export type RegisterIntakePayload = OpenApiSchemas['RegisterIntakeDto']
