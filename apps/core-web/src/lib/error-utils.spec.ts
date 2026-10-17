// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '@/lib/i18n'
import { getErrorBody, getErrorCode, getErrorMessage } from './error-utils'

describe('getErrorMessage', () => {
  beforeAll(async () => {
    await initI18n({ language: 'de' })
  })

  it('uses HTTP status fallback codes when the body has no wire code', () => {
    const message = getErrorMessage(
      {
        response: {
          status: 400,
          data: {
            message: 'inspected_on must be a valid date',
            eventId: 'evt_12345',
          },
        },
      },
      'fallback',
    )

    expect(message).toBe(
      'Die Anfrage konnte nicht verarbeitet werden. (Error ID: evt_12345)',
    )
    expect(message).not.toContain('inspected_on')
  })

  it('uses HTTP_500 copy for 5xx responses without a domain code', () => {
    const message = getErrorMessage(
      {
        status: 500,
        data: {
          message: 'Internal server error',
          requestId: 'req-1',
          eventId: 'evt-1',
        },
      },
      'fallback',
    )

    expect(message).toBe(
      'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut. (ref: req-1)',
    )
  })

  it('maps the active-order conflict code to translated copy', () => {
    const message = getErrorMessage(
      {
        status: 409,
        data: {
          message: 'Vehicle already has active order WO-2026-0007',
          code: 'VEHICLE_HAS_ACTIVE_ORDER',
          orderId: 'wo-live',
          orderNumber: 'WO-2026-0007',
        },
      },
      'fallback',
    )

    expect(message).toBe(
      'Für dieses Fahrzeug besteht bereits ein offener Werkstattauftrag (WO-2026-0007).',
    )
  })

  it('translates known wire codes instead of backend message text', () => {
    const message = getErrorMessage(
      {
        status: 422,
        data: {
          message: 'Seller identity is incomplete.',
          code: 'SELLER_IDENTITY_INCOMPLETE',
        },
      },
      'fallback',
    )

    expect(message).toBe(
      'Die Angaben zum Betrieb sind für den Versand unvollständig. Bitte ergänzen Sie sie.',
    )
  })

  it('reads the code and body from an API error', () => {
    const error = {
      status: 409,
      data: { code: 'VEHICLE_HAS_ACTIVE_ORDER', orderId: 'wo-live' },
    }

    expect(getErrorCode(error)).toBe('VEHICLE_HAS_ACTIVE_ORDER')
    expect(getErrorBody(error)).toEqual({ code: 'VEHICLE_HAS_ACTIVE_ORDER', orderId: 'wo-live' })
    expect(getErrorCode(new Error('plain'))).toBeUndefined()
  })

  it('returns fallback message when error is not object-like', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback')
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback')
    expect(getErrorMessage('string error', 'fallback')).toBe('fallback')
  })

  it('shows German copy for vehicle photo upload size errors', () => {
    const message = getErrorMessage(
      {
        response: {
          status: 413,
          data: {
            code: 'VEHICLE_PHOTO_TOO_LARGE',
            message: 'Vehicle photo exceeds the 10 MiB upload limit.',
          },
        },
      },
      'fallback',
    )

    expect(message).toBe(
      'Das Fahrzeugfoto ist größer als 10 MB.',
    )
  })

  it('uses HTTP_413 fallback when a 413 response has no domain code', () => {
    const message = getErrorMessage(
      {
        response: {
          status: 413,
          data: { message: 'Payload Too Large' },
        },
      },
      'fallback',
    )

    expect(message).toBe('Die Anfrage ist zu groß.')
  })

  it('re-resolves wire codes from errors thrown by throwHttpError', async () => {
    const { throwHttpError } = await import('./error-utils')
    const response = new Response(
      JSON.stringify({
        code: 'FISCAL_PERIOD_LOCKED',
        message: 'Fiscal period is locked for the selected date.',
      }),
      { status: 422 },
    )

    let thrown: unknown
    try {
      await throwHttpError(response, 'fallback')
    } catch (error) {
      thrown = error
    }

    expect(getErrorMessage(thrown, 'fallback')).toBe('Fiskalperiode ist gesperrt.')
  })
})
