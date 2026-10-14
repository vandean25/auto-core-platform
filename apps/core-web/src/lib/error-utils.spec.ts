// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getErrorBody, getErrorCode, getErrorMessage } from './error-utils'

describe('getErrorMessage', () => {
  it('appends event id when API response contains one', () => {
    const message = getErrorMessage(
      {
        response: {
          data: {
            message: 'Internal server error',
            eventId: 'evt_12345',
          },
        },
      },
      'fallback',
    )

    expect(message).toBe('Internal server error (Error ID: evt_12345)')
  })

  it('joins array messages from Nest validation errors into a single string', () => {
    const message = getErrorMessage(
      {
        response: {
          data: {
            message: ['name must not be empty', 'email must be an email'],
          },
        },
      },
      'fallback',
    )

    expect(message).toBe('name must not be empty, email must be an email')
  })

  it('joins array messages and appends event id', () => {
    const message = getErrorMessage(
      {
        response: {
          data: {
            message: ['field A is required', 'field B is required'],
            eventId: 'evt_abc',
          },
        },
      },
      'fallback',
    )

    expect(message).toBe('field A is required, field B is required (Error ID: evt_abc)')
  })

  it('shows a reference id for a 5xx response, preferring the request id', () => {
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

    expect(message).toBe('Internal server error (ref: req-1)')
  })

  it('falls back to the event id for a 5xx response without a request id', () => {
    const message = getErrorMessage(
      {
        response: {
          status: 503,
          data: { message: 'Queue service unavailable', eventId: 'evt-9' },
        },
      },
      'fallback',
    )

    expect(message).toBe('Queue service unavailable (ref: evt-9)')
  })

  it('does not repeat a reference the server already wrote into the message', () => {
    const message = getErrorMessage(
      {
        status: 500,
        data: { message: 'Something went wrong (ref: req-2)', requestId: 'req-2' },
      },
      'fallback',
    )

    expect(message).toBe('Something went wrong (ref: req-2)')
  })

  it('keeps the server copy, or the page fallback, for a 5xx response with no reference', () => {
    expect(getErrorMessage({ status: 500, message: 'Queue service unavailable' }, 'fallback')).toBe(
      'Queue service unavailable',
    )
    expect(getErrorMessage({ status: 500 }, 'fallback')).toBe('fallback')
  })

  it('maps the active-order conflict code to friendly copy', () => {
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

    expect(message).toBe('This vehicle already has an open workshop order (WO-2026-0007).')
    expect(
      getErrorMessage({ status: 409, data: { code: 'VEHICLE_HAS_ACTIVE_ORDER', orderId: 'wo-live' } }, 'fallback'),
    ).toBe('This vehicle already has an open workshop order.')
  })

  it('keeps the server message for codes without friendly copy', () => {
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

    expect(message).toBe('Seller identity is incomplete.')
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
})
