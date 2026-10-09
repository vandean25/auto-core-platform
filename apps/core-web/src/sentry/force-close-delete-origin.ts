import type { ErrorEvent } from '@sentry/react'

// The browser's IndexedDB layer rejects open connections with this message when it deletes an origin's
// storage (for example, an automated browser clearing site data). Nothing in the app can handle it, so
// unhandled rejections carrying this exact phrase are dropped. Handled errors and any other message are kept.
const FORCE_CLOSE_DELETE_ORIGIN_MESSAGE = 'Connection is closing because of: Force close delete origin'
const UNHANDLED_REJECTION_MECHANISM = 'auto.browser.global_handlers.onunhandledrejection'

export function isForceCloseDeleteOriginRejection(event: ErrorEvent): boolean {
  return (event.exception?.values ?? []).some(
    (exception) =>
      exception.mechanism?.type === UNHANDLED_REJECTION_MECHANISM &&
      exception.mechanism.handled === false &&
      exception.value?.includes(FORCE_CLOSE_DELETE_ORIGIN_MESSAGE) === true,
  )
}
