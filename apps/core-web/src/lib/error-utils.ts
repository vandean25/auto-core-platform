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

/** True when the carrier includes a Nest/axios JSON body (not a bare status on a thrown Error). */
function hasStructuredApiBody(error: unknown): boolean {
  if (!isObjectLike(error)) {
    return false
  }
  const apiError = error as ApiErrorLike
  return apiError.response?.data !== undefined || apiError.data !== undefined
}

/** The server's error body, from an axios-style `response.data` or a `data` field. */
export function getErrorBody(error: unknown) {
  return getApiErrorBody(error)
}

export function getErrorCode(error: unknown): string | undefined {
  const normalized = normalizeApiError(error)
  return normalized?.code ?? undefined
}

function appendServerReference(
  message: string,
  normalized: ReturnType<typeof normalizeApiError>,
  extraEventId?: string,
): string {
  const status = normalized?.status ?? null
  if (status !== null && status >= 500) {
    const reference =
      normalized?.requestId ||
      normalized?.eventId ||
      extraEventId
    if (reference && !message.includes('(ref: ')) {
      return `${message} (ref: ${reference})`
    }
  }

  const eventId = normalized?.eventId || extraEventId
  if (
    eventId &&
    (status === null || status < 500) &&
    !message.includes('(Error ID: ')
  ) {
    return `${message} (Error ID: ${eventId})`
  }

  return message
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (!isObjectLike(error)) {
    return fallbackMessage
  }

  const body = getApiErrorBody(error)
  const normalized = normalizeApiError(error)

  if (body?.code) {
    return appendServerReference(
      translateApiError(error, 'errors:generic.unexpected'),
      normalized,
      (error as ApiErrorLike).eventId,
    )
  }

  if (hasStructuredApiBody(error)) {
    return appendServerReference(
      fallbackMessage,
      normalized,
      (error as ApiErrorLike).eventId,
    )
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  const looseMessage = (error as ApiErrorLike).message
  if (typeof looseMessage === 'string' && looseMessage.length > 0) {
    return looseMessage
  }

  return fallbackMessage
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
  const message = getErrorMessage(synthetic, fallback)
  throw createHttpError(message, response.status)
}
