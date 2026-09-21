import { describe, expect, it } from 'vitest'
import { formatNestApiErrorMessage } from './sales-api-errors'

describe('formatNestApiErrorMessage', () => {
  it('formats Nest object bodies that include code', () => {
    expect(
      formatNestApiErrorMessage(
        {
          code: 'SOURCE_DOCUMENT_REQUIRED',
          message:
            'Direct source-less invoice creation is not supported. Create invoices from an eligible sales order.',
        },
        'Failed to create invoice',
      ),
    ).toBe(
      'SOURCE_DOCUMENT_REQUIRED: Direct source-less invoice creation is not supported. Create invoices from an eligible sales order.',
    )
  })

  it('uses message from GlobalExceptionFilter JSON (no code field)', () => {
    expect(
      formatNestApiErrorMessage(
        {
          statusCode: 400,
          message:
            'Direct source-less invoice creation is not supported. Create invoices from an eligible sales order.',
          error: 'Bad Request',
        },
        'Failed to create invoice',
      ),
    ).toBe(
      'Direct source-less invoice creation is not supported. Create invoices from an eligible sales order.',
    )
  })

  it('falls back when payload is empty', () => {
    expect(formatNestApiErrorMessage({}, 'Failed to create invoice')).toBe(
      'Failed to create invoice',
    )
  })
})
