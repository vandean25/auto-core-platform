import {
  getApiErrorBody,
  normalizeApiError,
  translateApiError,
} from '@/api/api-error'

/** @deprecated Use getApiErrorBody from `@/api/api-error`. */
export type ApiErrorBody = ReturnType<typeof getApiErrorBody> extends undefined
  ? never
  : NonNullable<ReturnType<typeof getApiErrorBody>>

export const VEHICLE_HAS_ACTIVE_ORDER_CODE = 'VEHICLE_HAS_ACTIVE_ORDER'

type ApiErrorLike = {
  message?: string | string[]
  name?: string
  status?: number
  eventId?: string
  data?: ReturnType<typeof getApiErrorBody>
  response?: {
    status?: number
    data?: ReturnType<typeof getApiErrorBody>
  }
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The server's error body, from an axios-style `response.data` or a `data` field. */
export function getErrorBody(error: unknown) {
  return getApiErrorBody(error)
}

export function getErrorCode(error: unknown): string | undefined {
  const normalized = normalizeApiError(error)
  return normalized?.code ?? undefined
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (!isObjectLike(error)) {
    return fallbackMessage
  }

  const normalized = normalizeApiError(error)
  if (normalized?.code) {
    const translated = translateApiError(error, 'errors:generic.unexpected')
    if (translated) {
      return translated
    }
  }

  const apiError = error as ApiErrorLike
  const status = getErrorStatus(error)
  if (status !== null && status >= 500) {
    const reference =
      normalized?.requestId ||
      normalized?.eventId ||
      apiError.eventId ||
      getErrorBody(error)?.requestId ||
      getErrorBody(error)?.eventId
    const baseMessage = fallbackMessage
    if (!reference || baseMessage.includes('(ref: ')) {
      return baseMessage
    }
    return `${baseMessage} (ref: ${reference})`
  }

  const eventId =
    normalized?.eventId ||
    apiError.response?.data?.eventId ||
    apiError.data?.eventId ||
    apiError.eventId

  if (!eventId) {
    return fallbackMessage
  }

  return `${fallbackMessage} (Error ID: ${eventId})`
}

export function getErrorStatus(error: unknown): number | null {
  if (!isObjectLike(error)) {
    return null
  }

  const apiError = error as ApiErrorLike
  const normalized = normalizeApiError(error)
  return (
    normalized?.status ??
    apiError.response?.status ??
    apiError.status ??
    null
  )
}

export function isAbortError(error: unknown): boolean {
  if (!isObjectLike(error)) {
    return false
  }

  const apiError = error as ApiErrorLike
  return apiError.name === 'AbortError'
}

/**
 * Creates an Error instance with an attached `.status` property so callers
 * can detect specific HTTP error codes (e.g. 409 Conflict) without parsing
 * the message string.
 */
export function createHttpError(message: string, status: number): Error & { status: number } {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}

/** Reads structured API errors and throws with `.status` attached (no backend message text). */
export async function throwHttpError(
  response: Response,
  fallback: string,
): Promise<never> {
  const synthetic = {
    response: {
      status: response.status,
      data: (await response.json().catch(() => undefined)) as
        | ReturnType<typeof getApiErrorBody>
        | undefined,
    },
  }
  const message = translateApiError(synthetic, 'errors:generic.unexpected') || fallback
  throw createHttpError(message, response.status)
}
