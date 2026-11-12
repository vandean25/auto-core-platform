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
