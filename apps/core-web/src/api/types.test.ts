import { describe, expect, it } from 'vitest'
import type {
  Brand,
  CatalogPartSearchItem,
  CatalogSearchResponse,
  CreatePurchaseInvoiceDto,
  CreateWorkshopOrderPayload,
  Customer,
  FinanceSettings,
  Invoice,
  LaborOperationSearchItem,
  LaborOperationSearchResponse,
  PurchaseInvoice,
  PurchaseOrder,
  RegisterIntakePayload,
  RevenueAnalytics,
  RevenueGroup,
  SalesOrder,
  UnbilledReceiptItem,
  Vehicle,
  Vendor,
  WorkshopPickPartsPayload,
  WorkshopPickPartsResponse,
} from './types'
import type { components } from './generated/openapi'

type Schemas = components['schemas']

type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends <
  T,
>() => T extends Right ? 1 : 2
  ? true
  : false

type ExpectTrue<Value extends true> = Value

export type OpenApiAliasChecks = [
  ExpectTrue<Equal<Brand, Schemas['BrandResponseDto']>>,
  ExpectTrue<Equal<Vendor, Schemas['VendorResponseDto']>>,
  ExpectTrue<Equal<Customer, Schemas['CustomerResponseDto']>>,
  ExpectTrue<Equal<Vehicle, Schemas['VehicleResponseDto']>>,
  ExpectTrue<Equal<SalesOrder, Schemas['SalesOrderResponseDto']>>,
  ExpectTrue<Equal<Invoice, Schemas['InvoiceResponseDto']>>,
  ExpectTrue<Equal<PurchaseOrder, Schemas['PurchaseOrderResponseDto']>>,
  ExpectTrue<Equal<PurchaseInvoice, Schemas['PurchaseInvoiceResponseDto']>>,
  ExpectTrue<Equal<UnbilledReceiptItem, Schemas['UnbilledReceiptItemDto']>>,
  ExpectTrue<Equal<CreatePurchaseInvoiceDto, Schemas['CreatePurchaseInvoiceDto']>>,
  ExpectTrue<Equal<FinanceSettings, Schemas['FinanceSettingsResponseDto']>>,
  ExpectTrue<Equal<RevenueGroup, Schemas['RevenueGroupResponseDto']>>,
  ExpectTrue<Equal<RevenueAnalytics, Schemas['RevenueAnalyticsResponseDto']>>,
  ExpectTrue<Equal<LaborOperationSearchItem, Schemas['LaborOperationSearchItemDto']>>,
  ExpectTrue<
    Equal<LaborOperationSearchResponse, Schemas['LaborOperationSearchResponseDto']>
  >,
  ExpectTrue<Equal<CatalogPartSearchItem, Schemas['CatalogPartSearchItemDto']>>,
  ExpectTrue<Equal<CatalogSearchResponse, Schemas['CatalogSearchResponseDto']>>,
  ExpectTrue<Equal<CreateWorkshopOrderPayload, Schemas['CreateWorkshopOrderDto']>>,
  ExpectTrue<Equal<RegisterIntakePayload, Schemas['RegisterIntakeDto']>>,
  ExpectTrue<Equal<WorkshopPickPartsPayload, Schemas['PickWorkshopPartsDto']>>,
  ExpectTrue<
    Equal<WorkshopPickPartsResponse, Schemas['PickWorkshopPartsResponseDto']>
  >,
]

describe('API domain types', () => {
  it('are compile-time aliases of generated OpenAPI schemas', () => {
    const aliasesHold: Equal<Brand, Schemas['BrandResponseDto']> = true
    expect(aliasesHold).toBe(true)
  })
})
