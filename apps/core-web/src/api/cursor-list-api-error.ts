import { normalizeApiError, type ApiErrorBody } from './api-error'

export class CursorListApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.name = 'CursorListApiError'
    this.status = status
    this.code = code
  }
}

/**
 * A cursor response that must not be shown: it answers an older scope generation, or a scope the request did not send.
 * A real error, not a TanStack `CancelledError`: thrown from a query function, a cancel never settles the fetch. A late
 * generation is read once more (that attempt carries the current generation); a foreign scope is not retried.
 */
export class StaleScopeResponseError extends Error {
  readonly retryable: boolean

  constructor(retryable: boolean) {
    super('stale_scope_context_response')
    this.name = 'StaleScopeResponseError'
    this.retryable = retryable
  }
}

export function isCursorListApiError(error: unknown): error is CursorListApiError {
  return error instanceof CursorListApiError
}

export async function throwCursorListApiError(response: Response, fallbackMessage: string): Promise<never> {
  const payload = (await response.json().catch(() => undefined)) as ApiErrorBody | undefined
  const normalized = normalizeApiError({ response: { status: response.status, data: payload } })
  const code = normalized?.code ?? null
  const message = code ?? fallbackMessage
  throw new CursorListApiError(message, response.status, code)
}
