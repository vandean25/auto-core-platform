import { describe, expect, it, vi } from 'vitest'
import { translateListingIssue } from './listing-issue-i18n'

describe('translateListingIssue', () => {
  it('uses validation code keys instead of API messages', () => {
    const t = vi.fn((key: string) => (key === 'listing.validation.LISTING_PRICE_REQUIRED' ? 'Price required' : ''))
    const message = translateListingIssue(t as never, {
      field: 'price_gross_eur',
      message: 'A gross asking price greater than zero is required.',
      code: 'LISTING_PRICE_REQUIRED',
    })
    expect(message).toBe('Price required')
    expect(t).toHaveBeenCalledWith('listing.validation.LISTING_PRICE_REQUIRED', {
      defaultValue: '',
      field: 'price_gross_eur',
    })
  })
})
