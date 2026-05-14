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
})
