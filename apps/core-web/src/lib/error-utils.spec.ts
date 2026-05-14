import { describe, expect, it } from 'vitest'
import { getErrorMessage } from './error-utils'

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

  it('returns fallback message when error is not object-like', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback')
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback')
    expect(getErrorMessage('string error', 'fallback')).toBe('fallback')
  })
})
