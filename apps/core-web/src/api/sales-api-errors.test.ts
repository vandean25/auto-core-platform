// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '@/lib/i18n'
import { formatNestApiErrorMessage } from './sales-api-errors'

describe('formatNestApiErrorMessage', () => {
  beforeAll(async () => {
    await initI18n({ language: 'de' })
  })

  it('translates structured Nest bodies by code without backend message text', () => {
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
      'Rechnungen ohne zugrunde liegenden Auftrag sind nicht möglich. Bitte legen Sie die Rechnung aus einem Kundenauftrag an.',
    )
  })

  it('uses the caller fallback when no code is present', () => {
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
    ).toBe('Failed to create invoice')
  })

  it('falls back when payload is empty', () => {
    expect(formatNestApiErrorMessage({}, 'Failed to create invoice')).toBe(
      'Failed to create invoice',
    )
  })

  it('translates the branding writer gate by code', () => {
    expect(
      formatNestApiErrorMessage(
        {
          code: 'INVOICE_BRANDING_WRITER_DISABLED',
          message:
            'Invoice commitment is temporarily unavailable while branded invoice issuance is disabled.',
          statusCode: 503,
          error: 'Service Unavailable',
        },
        'Failed to finalize invoice',
      ),
    ).toContain('Rechnungen mit Briefpapier')
  })
})
