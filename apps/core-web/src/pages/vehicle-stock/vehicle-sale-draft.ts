import type { VehicleSale } from '@/api/vehicle-stock'
import type { Customer } from '@/api/types'

export type VehicleSaleDraftFacts = {
  vehicle_id: string
  customer_id: string
  sale_price: number
  contract_concluded_at: string | null
  handed_over_at: string | null
  buyer_is_consumer: boolean
  gewaehrleistung_shortened_negotiated: boolean
  gewaehrleistung_note: string | null
  garantie_months: number | null
  garantie_terms: string | null
}

/** The sale fields as the form edits them (text inputs and checkboxes). */
export type VehicleSaleFormValues = {
  salePrice: string
  contractDate: string
  handoverDate: string
  buyerIsConsumer: boolean
  shorteningNegotiated: boolean
  warrantyNote: string
  garantieMonthsInput: string
  garantieTerms: string
}

export function buildVehicleSaleDraftFacts(input: {
  vehicleId: string
  customerId: string
  salePrice: number
  contractDate: string
  handoverDate: string
  buyerIsConsumer: boolean
  shorteningNegotiated: boolean
  warrantyNote: string
  garantieMonths: number | null
  garantieTerms: string
}): VehicleSaleDraftFacts {
  return {
    vehicle_id: input.vehicleId,
    customer_id: input.customerId,
    sale_price: input.salePrice,
    contract_concluded_at: input.contractDate || null,
    handed_over_at: input.handoverDate || null,
    buyer_is_consumer: input.buyerIsConsumer,
    gewaehrleistung_shortened_negotiated:
      input.buyerIsConsumer && input.shorteningNegotiated,
    gewaehrleistung_note: input.warrantyNote || null,
    garantie_months: input.garantieMonths,
    garantie_terms:
      input.garantieMonths === null ? null : input.garantieTerms || null,
  }
}

function storedDate(value: string | null | undefined) {
  return value?.slice(0, 10) ?? ''
}

export function storedSaleFormValues(sale: VehicleSale): VehicleSaleFormValues {
  return {
    salePrice: String(sale.sale_price),
    contractDate: storedDate(sale.contract_concluded_at),
    handoverDate: storedDate(sale.handed_over_at),
    buyerIsConsumer: sale.buyer_is_consumer ?? sale.customer?.type === 'PRIVATE',
    shorteningNegotiated: sale.gewaehrleistung_shortened_negotiated ?? false,
    warrantyNote: sale.gewaehrleistung_note ?? '',
    garantieMonthsInput: sale.garantie_months != null ? String(sale.garantie_months) : '',
    garantieTerms: sale.garantie_terms ?? '',
  }
}

/** Built by the same function as the autosave, so reopening an unchanged sale does not look like an edit. */
export function storedSaleSerialized(sale: VehicleSale) {
  const stored = storedSaleFormValues(sale)
  return JSON.stringify(buildVehicleSaleDraftFacts({
    vehicleId: sale.vehicle_id,
    customerId: sale.customer_id,
    salePrice: Number(sale.sale_price),
    contractDate: stored.contractDate,
    handoverDate: stored.handoverDate,
    buyerIsConsumer: stored.buyerIsConsumer,
    shorteningNegotiated: stored.shorteningNegotiated,
    warrantyNote: stored.warrantyNote,
    garantieMonths: sale.garantie_months ?? null,
    garantieTerms: stored.garantieTerms,
  }))
}

export function customerFromSale(customer: NonNullable<VehicleSale['customer']>): Customer {
  return {
    id: customer.id,
    type: customer.type,
    first_name: customer.first_name,
    last_name: customer.last_name,
    company_name: customer.company_name ?? undefined,
    email: customer.email ?? '',
  }
}
