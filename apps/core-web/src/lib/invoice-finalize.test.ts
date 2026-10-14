// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  assertFinalizedInvoice,
  FINALIZE_AUTOSAVE_ERROR_MESSAGE,
  FINALIZE_MISSING_CUSTOMER_MESSAGE,
  FINALIZE_NOT_NUMBERED_MESSAGE,
  FINALIZE_SAVING_MESSAGE,
  getInvoiceFinalizeBlockMessage,
} from './invoice-finalize'

describe('getInvoiceFinalizeBlockMessage', () => {
  it('lets finalize proceed when the draft has a customer and is saved', () => {
    expect(getInvoiceFinalizeBlockMessage({ hasCustomer: true, saveStatus: 'saved' })).toBeNull()
  })

  it('asks for a customer first', () => {
    expect(getInvoiceFinalizeBlockMessage({ hasCustomer: false, saveStatus: 'saved' })).toBe(
      FINALIZE_MISSING_CUSTOMER_MESSAGE,
    )
  })

  it('waits while autosave is running and blocks after an autosave error', () => {
    expect(getInvoiceFinalizeBlockMessage({ hasCustomer: true, saveStatus: 'saving' })).toBe(
      FINALIZE_SAVING_MESSAGE,
    )
    expect(getInvoiceFinalizeBlockMessage({ hasCustomer: true, saveStatus: 'error' })).toBe(
      FINALIZE_AUTOSAVE_ERROR_MESSAGE,
    )
  })
})

describe('assertFinalizedInvoice', () => {
  it('accepts a FINALIZED invoice that has its RE number', () => {
    expect(() =>
      assertFinalizedInvoice({ status: 'FINALIZED', invoice_number: 'RE-2026-0001' }),
    ).not.toThrow()
  })

  it('rejects a response that is still a draft or has no number', () => {
    expect(() =>
      assertFinalizedInvoice({ status: 'DRAFT', invoice_number: 'RE-2026-0001' }),
    ).toThrow(FINALIZE_NOT_NUMBERED_MESSAGE)
    expect(() =>
      assertFinalizedInvoice({ status: 'FINALIZED', invoice_number: null }),
    ).toThrow(FINALIZE_NOT_NUMBERED_MESSAGE)
  })
})
