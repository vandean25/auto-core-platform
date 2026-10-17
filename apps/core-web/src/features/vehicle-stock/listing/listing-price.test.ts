import { describe, expect, it } from 'vitest'
import { parseListingGrossPrice } from './listing-price'

describe('parseListingGrossPrice', () => {
  it('parses German grouped decimals', () => {
    expect(parseListingGrossPrice('14.500,50')).toEqual({ valid: true, value: 14500.5 })
  })

  it('treats blank input as cleared price', () => {
    expect(parseListingGrossPrice('   ')).toEqual({ valid: true, value: null })
  })

  it('rejects malformed values', () => {
    expect(parseListingGrossPrice('abc')).toEqual({ valid: false, value: null })
  })
})
