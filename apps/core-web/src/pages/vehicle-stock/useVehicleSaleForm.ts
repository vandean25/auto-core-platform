import { useEffect, useMemo, useRef, useState } from 'react'
import type { VehicleSale } from '@/api/vehicle-stock'
import type { Customer } from '@/api/types'
import { parseGarantieMonths } from '@/lib/vehicle-sale-warranty'
import {
  buildVehicleSaleDraftFacts,
  customerFromSale,
  storedSaleFormValues,
} from './vehicle-sale-draft'

export type VehicleSaleForm = ReturnType<typeof useVehicleSaleForm>

/** Form state of a vehicle sale: the fields, their hydration from the stored sale and the buyer rules between them. */
export function useVehicleSaleForm(existing: VehicleSale | undefined, vehicleId: string) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [salePrice, setSalePrice] = useState('')
  const [contractDate, setContractDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [handoverDate, setHandoverDate] = useState('')
  const [buyerIsConsumer, setBuyerIsConsumer] = useState(true)
  const [shorteningNegotiated, setShorteningNegotiated] = useState(false)
  const [warrantyNote, setWarrantyNote] = useState('')
  const [garantieMonthsInput, setGarantieMonthsInput] = useState('')
  const [garantieTerms, setGarantieTerms] = useState('')
  const garantie = parseGarantieMonths(garantieMonthsInput)
  const hydratedSaleId = useRef<string | null>(null)

  useEffect(() => {
    if (!existing || hydratedSaleId.current === existing.id) return
    hydratedSaleId.current = existing.id
    const stored = storedSaleFormValues(existing)
    setSalePrice(stored.salePrice)
    setContractDate(stored.contractDate)
    setHandoverDate(stored.handoverDate)
    setBuyerIsConsumer(stored.buyerIsConsumer)
    setShorteningNegotiated(stored.shorteningNegotiated)
    setWarrantyNote(stored.warrantyNote)
    setGarantieMonthsInput(stored.garantieMonthsInput)
    setGarantieTerms(stored.garantieTerms)
    if (existing.customer) setCustomer(customerFromSale(existing.customer))
  }, [existing])

  // Only a consumer buyer can agree to a shortened Gewährleistung.
  const changeBuyerIsConsumer = (isConsumer: boolean) => {
    setBuyerIsConsumer(isConsumer)
    if (!isConsumer) setShorteningNegotiated(false)
  }

  const selectCustomer = (nextCustomer: Customer | null) => {
    setCustomer(nextCustomer)
    if (nextCustomer) changeBuyerIsConsumer(nextCustomer.type === 'PRIVATE')
  }

  const changeGarantieMonths = (value: string) => {
    setGarantieMonthsInput(value)
    // Terms only apply with a duration, so clearing the duration clears the terms.
    if (value.trim() === '') setGarantieTerms('')
  }

  const customerId = customer?.id || existing?.customer_id || ''
  const priceNumber = Number(salePrice)
  const facts = useMemo(() => buildVehicleSaleDraftFacts({
    vehicleId,
    customerId,
    salePrice: priceNumber,
    contractDate,
    handoverDate,
    buyerIsConsumer,
    shorteningNegotiated,
    warrantyNote,
    garantieMonths: garantie.value,
    garantieTerms,
  }), [vehicleId, customerId, priceNumber, contractDate, handoverDate, buyerIsConsumer, shorteningNegotiated, warrantyNote, garantie.value, garantieTerms])

  return {
    customer,
    selectCustomer,
    salePrice,
    setSalePrice,
    priceNumber,
    contractDate,
    setContractDate,
    handoverDate,
    setHandoverDate,
    buyerIsConsumer,
    changeBuyerIsConsumer,
    shorteningNegotiated,
    setShorteningNegotiated,
    warrantyNote,
    setWarrantyNote,
    garantieMonthsInput,
    changeGarantieMonths,
    garantie,
    garantieTerms,
    setGarantieTerms,
    facts,
    /** Vehicle, buyer and price are set, so the sale can be saved. */
    hasRequiredFacts: Boolean(vehicleId && customerId && priceNumber),
  }
}
