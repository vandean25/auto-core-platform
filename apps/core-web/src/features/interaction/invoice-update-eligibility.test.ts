import { describe, expect, it } from 'vitest'

import { isInvoiceUpdateOptimisticEligible } from './invoice-update-eligibility'

describe('isInvoiceUpdateOptimisticEligible', () => {
  it.each([
    [{ changedFields: ['internalNotes'] }, true],
    [{ changedFields: ['notes'] }, true],
    [{ changedFields: ['notes', 'internalNotes'] }, true],
    [{ changedFields: undefined }, false],
    [{ changedFields: [] }, false],
    [{ changedFields: ['internalNotes', 'items'] }, false],
    [{ changedFields: ['customerId'] }, false],
  ])('%j is eligible: %s', (variables, eligible) => {
    expect(isInvoiceUpdateOptimisticEligible(variables)).toBe(eligible)
  })
})
