import type { VehicleSaleTradeInInput, VehicleSaleTradeInPurchase } from '@/api/vehicle-stock'

/** ISO 3779 VIN: 17 characters, no I, O or Q. Matches the backend DTO. */
export const TRADE_IN_VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/

export type TradeInDraft = {
  allowance: string
  vin: string
  make: string
  model: string
  year: string
  mileage: string
  firstRegistrationDate: string
  plate: string
  color: string
}

export const EMPTY_TRADE_IN_DRAFT: TradeInDraft = {
  allowance: '',
  vin: '',
  make: '',
  model: '',
  year: '',
  mileage: '',
  firstRegistrationDate: '',
  plate: '',
  color: '',
}

export function tradeInDraftFromPurchase(purchase: VehicleSaleTradeInPurchase | null | undefined): TradeInDraft {
  if (!purchase) return EMPTY_TRADE_IN_DRAFT
  return {
    allowance: String(purchase.purchase_price),
    vin: purchase.vin ?? '',
    make: purchase.make,
    model: purchase.model,
    year: String(purchase.year),
    mileage: purchase.mileage == null ? '' : String(purchase.mileage),
    firstRegistrationDate: purchase.first_registration_date?.slice(0, 10) ?? '',
    plate: purchase.plate ?? '',
    color: purchase.color ?? '',
  }
}

export type TradeInDraftResult =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'valid'; input: VehicleSaleTradeInInput }

/**
 * Validates the trade-in form the same way the backend does, so the autosave only sends
 * payloads the server accepts. The backend stays the authority on every rule.
 */
export function buildTradeInInput(draft: TradeInDraft, salePrice: number, today: Date = new Date()): TradeInDraftResult {
  const hasAnyValue = Object.values(draft).some((value) => value.trim() !== '')
  if (!hasAnyValue) return { status: 'empty' }

  const allowanceText = draft.allowance.trim()
  const allowance = Number(allowanceText)
  if (!allowanceText || !Number.isFinite(allowance) || allowance <= 0) {
    return { status: 'invalid', message: 'Enter a trade-in allowance greater than zero.' }
  }
  if (!/^\d+(\.\d{1,2})?$/.test(allowanceText)) {
    return { status: 'invalid', message: 'The allowance can have at most two decimal places.' }
  }
  if (Number.isFinite(salePrice) && salePrice > 0 && allowance > salePrice) {
    return { status: 'invalid', message: 'The allowance cannot exceed the sale price.' }
  }

  const vin = draft.vin.trim().toUpperCase()
  if (!TRADE_IN_VIN_PATTERN.test(vin)) {
    return { status: 'invalid', message: 'The VIN must have 17 characters and no I, O or Q.' }
  }

  const make = draft.make.trim()
  const model = draft.model.trim()
  if (!make || !model) {
    return { status: 'invalid', message: 'Enter the make and model of the trade-in vehicle.' }
  }

  const year = Number(draft.year)
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return { status: 'invalid', message: 'Enter a valid model year.' }
  }

  const mileageText = draft.mileage.trim()
  const mileage = mileageText === '' ? undefined : Number(mileageText)
  if (mileage !== undefined && (!Number.isInteger(mileage) || mileage < 0)) {
    return { status: 'invalid', message: 'Mileage must be a whole number of zero or more.' }
  }

  const firstRegistration = draft.firstRegistrationDate.trim()
  if (firstRegistration && new Date(firstRegistration).getTime() > today.getTime()) {
    return { status: 'invalid', message: 'First registration cannot be in the future.' }
  }

  return {
    status: 'valid',
    input: {
      allowance,
      vin,
      make,
      model,
      year,
      mileage,
      first_registration_date: firstRegistration || undefined,
      plate: draft.plate.trim() || undefined,
      color: draft.color.trim() || undefined,
    },
  }
}
