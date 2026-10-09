import type { ErrorEvent } from '@sentry/react'
import { describe, expect, it } from 'vitest'
import { isForceCloseDeleteOriginRejection } from './force-close-delete-origin'

const FORCE_CLOSE_MESSAGE = 'Connection is closing because of: Force close delete origin'
const UNHANDLED_REJECTION = 'auto.browser.global_handlers.onunhandledrejection'

function exceptionEvent(
  value: string,
  mechanism: { type: string; handled: boolean } = { type: UNHANDLED_REJECTION, handled: false },
): ErrorEvent {
  return { exception: { values: [{ type: 'UnknownError', value, mechanism }] } } as unknown as ErrorEvent
}

describe('isForceCloseDeleteOriginRejection', () => {
  it('matches the unhandled IndexedDB rejection raised when the browser deletes the origin', () => {
    expect(isForceCloseDeleteOriginRejection(exceptionEvent(FORCE_CLOSE_MESSAGE))).toBe(true)
  })

  it('matches when the message is prefixed with the error name', () => {
    expect(isForceCloseDeleteOriginRejection(exceptionEvent(`UnknownError: ${FORCE_CLOSE_MESSAGE}`))).toBe(true)
  })

  it('keeps unrelated unhandled rejections', () => {
    expect(isForceCloseDeleteOriginRejection(exceptionEvent('Failed to fetch'))).toBe(false)
  })

  it('keeps messages that only resemble the exact phrase', () => {
    expect(
      isForceCloseDeleteOriginRejection(exceptionEvent('Connection is closing because of: Force close delete database')),
    ).toBe(false)
  })

  it('keeps handled errors with the same message', () => {
    expect(
      isForceCloseDeleteOriginRejection(exceptionEvent(FORCE_CLOSE_MESSAGE, { type: UNHANDLED_REJECTION, handled: true })),
    ).toBe(false)
  })

  it('keeps errors with the same message that do not come from an unhandled rejection', () => {
    expect(
      isForceCloseDeleteOriginRejection(
        exceptionEvent(FORCE_CLOSE_MESSAGE, { type: 'auto.browser.global_handlers.onerror', handled: false }),
      ),
    ).toBe(false)
  })

  it('keeps events without exception values', () => {
    expect(isForceCloseDeleteOriginRejection({ message: FORCE_CLOSE_MESSAGE } as unknown as ErrorEvent)).toBe(false)
  })
})
