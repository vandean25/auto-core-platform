import { describe, expect, it } from 'vitest'
import {
  EMPTY_TRADE_IN_DRAFT,
  buildTradeInInput,
  tradeInDraftFromPurchase,
  type TradeInDraft,
} from './vehicle-sale-trade-in'

const TODAY = new Date('2026-10-09T12:00:00Z')

const validDraft: TradeInDraft = {
  allowance: '15000',
  vin: 'trdnb000000000001',
  make: 'Skoda',
  model: 'Octavia',
  year: '2016',
  mileage: '98000',
  firstRegistrationDate: '2016-03-01',
  plate: '',
  color: ' ',
}

describe('buildTradeInInput', () => {
  it('reports an untouched form as empty so nothing is saved', () => {
    expect(buildTradeInInput(EMPTY_TRADE_IN_DRAFT, 20000, TODAY)).toEqual({ status: 'empty' })
  })

  it('builds the payload with a normalised VIN and omits blank optional fields', () => {
    const result = buildTradeInInput(validDraft, 20000, TODAY)

    expect(result).toEqual({
      status: 'valid',
      input: {
        allowance: 15000,
        vin: 'TRDNB000000000001',
        make: 'Skoda',
        model: 'Octavia',
        year: 2016,
        mileage: 98000,
        first_registration_date: '2016-03-01',
        plate: undefined,
        color: undefined,
      },
    })
  })

  it('accepts an allowance with cents without float rounding errors', () => {
    const result = buildTradeInInput({ ...validDraft, allowance: '15000.10' }, 20000, TODAY)
    expect(result.status).toBe('valid')
    if (result.status === 'valid') expect(result.input.allowance).toBe(15000.1)
  })

  it.each([
    ['zero', '0', 'Enter a trade-in allowance greater than zero.'],
    ['negative', '-250', 'Enter a trade-in allowance greater than zero.'],
    ['more than two decimals', '15000.005', 'The allowance can have at most two decimal places.'],
    ['above the sale price', '20000.01', 'The allowance cannot exceed the sale price.'],
  ])('rejects an allowance that is %s', (_label, allowance, message) => {
    expect(buildTradeInInput({ ...validDraft, allowance }, 20000, TODAY)).toEqual({
      status: 'invalid',
      message,
    })
  })

  it('accepts an allowance equal to the sale price', () => {
    expect(buildTradeInInput({ ...validDraft, allowance: '20000' }, 20000, TODAY).status).toBe('valid')
  })

  it.each([
    ['too short', 'TRDNB00000000001'],
    ['contains I', 'TRDNB00000000000I'],
    ['contains O', 'TRDNB0000000000O1'],
    ['contains Q', 'TRDNB0000000000Q1'],
  ])('rejects a VIN that is %s', (_label, vin) => {
    expect(buildTradeInInput({ ...validDraft, vin }, 20000, TODAY)).toEqual({
      status: 'invalid',
      message: 'The VIN must have 17 characters and no I, O or Q.',
    })
  })

  it('requires make and model', () => {
    expect(buildTradeInInput({ ...validDraft, model: '  ' }, 20000, TODAY)).toEqual({
      status: 'invalid',
      message: 'Enter the make and model of the trade-in vehicle.',
    })
  })

  it('rejects an implausible model year', () => {
    expect(buildTradeInInput({ ...validDraft, year: '1850' }, 20000, TODAY)).toEqual({
      status: 'invalid',
      message: 'Enter a valid model year.',
    })
  })

  it('rejects negative or fractional mileage', () => {
    const message = 'Mileage must be a whole number of zero or more.'
    expect(buildTradeInInput({ ...validDraft, mileage: '-1' }, 20000, TODAY)).toEqual({ status: 'invalid', message })
    expect(buildTradeInInput({ ...validDraft, mileage: '10.5' }, 20000, TODAY)).toEqual({ status: 'invalid', message })
  })

  it('rejects a first registration date in the future', () => {
    expect(buildTradeInInput({ ...validDraft, firstRegistrationDate: '2027-01-01' }, 20000, TODAY)).toEqual({
      status: 'invalid',
      message: 'First registration cannot be in the future.',
    })
  })
})

describe('tradeInDraftFromPurchase', () => {
  it('hydrates the form from a saved trade-in purchase', () => {
    expect(
      tradeInDraftFromPurchase({
        id: 'purchase-1',
        purchase_number: 'VP-2026-0002',
        status: 'DRAFT',
        vin: 'TRDNB000000000001',
        make: 'Skoda',
        model: 'Octavia',
        year: 2016,
        mileage: 98000,
        first_registration_date: '2016-03-01T00:00:00.000Z',
        plate: null,
        color: 'Silver',
        purchase_price: '15000.00',
      }),
    ).toEqual({
      allowance: '15000.00',
      vin: 'TRDNB000000000001',
      make: 'Skoda',
      model: 'Octavia',
      year: '2016',
      mileage: '98000',
      firstRegistrationDate: '2016-03-01',
      plate: '',
      color: 'Silver',
    })
  })

  it('returns an empty draft when there is no trade-in', () => {
    expect(tradeInDraftFromPurchase(null)).toEqual(EMPTY_TRADE_IN_DRAFT)
  })
})
