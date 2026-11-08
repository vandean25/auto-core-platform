import { describe, expect, it } from 'vitest'

import { isVendorUpdateOptimisticEligible } from './parts-purchasing-update-eligibility'

describe('isVendorUpdateOptimisticEligible', () => {
  it.each([
    { name: 'name', data: { name: 'Nord' }, expected: true },
    { name: 'email', data: { email: 'lager@example.test' }, expected: true },
    { name: 'account number', data: { account_number: '70001' }, expected: true },
    { name: 'supported brands', data: { brandIds: [1] }, expected: false },
    { name: 'name together with brands', data: { name: 'Nord', brandIds: [1] }, expected: false },
    { name: 'empty patch', data: {}, expected: false },
  ])('$name is eligible: $expected', ({ data, expected }) => {
    expect(isVendorUpdateOptimisticEligible({ data })).toBe(expected)
  })
})
