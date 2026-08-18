import { describe, expect, it } from 'vitest'
import { validatePartRequest } from './part-request'

describe('validatePartRequest', () => {
  it('requires a part number', () => {
    expect(validatePartRequest({ itemNo: '  ', description: 'Oil filter', qty: '1' })).toBe(
      'Part number is required.',
    )
  })

  it('requires a description', () => {
    expect(validatePartRequest({ itemNo: 'OIL-01', description: '  ', qty: '1' })).toBe(
      'Description is required.',
    )
  })

  it('rejects quantities below 0.01', () => {
    expect(validatePartRequest({ itemNo: 'OIL-01', description: 'Oil filter', qty: '0' })).toBe(
      'Quantity must be at least 0.01.',
    )
  })

  it('rejects non-numeric quantities', () => {
    expect(validatePartRequest({ itemNo: 'OIL-01', description: 'Oil filter', qty: 'abc' })).toBe(
      'Quantity must be at least 0.01.',
    )
  })

  it('accepts a valid request and returns null', () => {
    expect(validatePartRequest({ itemNo: 'OIL-01', description: 'Oil filter', qty: '2' })).toBeNull()
  })
})
