import { describe, expect, it, beforeAll } from 'vitest'
import { initI18n, changeUiLanguage } from '@/lib/i18n'
import { normalizeApiError, translateApiError } from './api-error'

describe('api-error decoder', () => {
  beforeAll(async () => {
    await initI18n({ language: 'de' })
  })

  it('translates a known wire code using errors:codes without backend message text', () => {
    const error = {
      response: {
        status: 409,
        data: {
          code: 'CHECK_IN_CONFLICT',
          message: 'English diagnostic only',
        },
      },
    }
    expect(translateApiError(error)).toBe(
      'Die Annahme wurde zwischenzeitlich geändert. Bitte laden Sie die Seite neu und versuchen Sie es erneut.',
    )
  })

  it('interpolates allowlisted params for vehicle active order conflicts', () => {
    const error = {
      response: {
        status: 409,
        data: {
          code: 'VEHICLE_HAS_ACTIVE_ORDER',
          message: 'ignored',
          orderNumber: 'WO-2026-0042',
        },
      },
    }
    const normalized = normalizeApiError(error)
    expect(normalized?.params.orderNumber).toBe('WO-2026-0042')
    const text = translateApiError(error)
    expect(text).toContain('WO-2026-0042')
    expect(text).not.toContain('ignored')
  })

  it('falls back to generic unexpected copy for unknown codes', () => {
    const error = {
      response: {
        status: 400,
        data: {
          code: 'TOTALLY_UNKNOWN_CODE',
          message: 'Do not show this',
        },
      },
    }
    expect(translateApiError(error)).toBe(
      'Ein unerwarteter Fehler ist aufgetreten.',
    )
  })

  it('switches language when the UI language changes', async () => {
    const error = {
      response: {
        status: 409,
        data: { code: 'CHECK_IN_EXISTS', message: 'ignored' },
      },
    }
    await changeUiLanguage('en')
    expect(translateApiError(error)).toContain('check-in already exists')
    await changeUiLanguage('de')
  })
})
