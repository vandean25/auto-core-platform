import { describe, expect, it } from 'vitest'
import { formatNestApiErrorMessage } from './sales-api-errors'

describe('formatNestApiErrorMessage', () => {
  it('includes API code and message for Nest BadRequest payloads', () => {
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

  it('falls back when payload is empty', () => {
    expect(formatNestApiErrorMessage({}, 'Failed to create invoice')).toBe(
      'Failed to create invoice',
    )
  })
})
