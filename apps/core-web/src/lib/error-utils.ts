import {
  getApiErrorBody,
  normalizeApiError,
  translateApiError,
} from '@/api/api-error'
import { wireCodeForHttpStatus } from '@/api/http-status-fallback-codes'
import { i18n } from '@/lib/i18n'

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
  return resolveWireErrorCode(error) ?? undefined
}

export function resolveWireErrorCode(error: unknown): string | null {
  const body = getApiErrorBody(error)
  if (typeof body?.code === 'string' && body.code.length > 0) {
    return body.code
  }
  const status = getErrorStatus(error)
  if (status !== null) {
    return wireCodeForHttpStatus(status)
  }
  return null
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

function syntheticErrorForTranslation(error: unknown, wireCode: string) {
  const body = getApiErrorBody(error)
  const status = getErrorStatus(error)
  return {
    response: {
      status: status ?? body?.statusCode ?? 400,
      data: { ...body, code: wireCode },
    },
  }
}

/** A wire code the web app has no copy for says less than the caller's own failure text. */
function hasWireCodeCopy(code: string): boolean {
  return i18n.exists(`errors:codes.${code}`)
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (!isObjectLike(error)) {
    return fallbackMessage
  }

  const wireCode = resolveWireErrorCode(error)
  const normalized = normalizeApiError(error)
  const message =
    wireCode && hasWireCodeCopy(wireCode)
      ? translateApiError(
          syntheticErrorForTranslation(error, wireCode),
          'errors:generic.unexpected',
        )
      : fallbackMessage

  return appendServerReference(message, normalized, (error as ApiErrorLike).eventId)
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
export type HttpError = Error & {
  status: number
  response?: {
    status: number
    data?: ReturnType<typeof getApiErrorBody>
  }
}

export function getHttpErrorStatus(error: unknown): number | null {
  if (!isObjectLike(error)) {
    return null
  }
  const status = error.status
  if (typeof status === 'number') {
    return status
  }
  const response = error.response
  if (isObjectLike(response) && typeof response.status === 'number') {
    return response.status
  }
  return null
}

export function createHttpError(
  message: string,
  status: number,
  body?: ReturnType<typeof getApiErrorBody>,
): HttpError {
  const err = new Error(message) as HttpError
  err.status = status
  if (body !== undefined) {
    err.response = { status, data: body }
  }
  return err
}

/** Reads structured API errors from a Response and translates known codes, or returns the fallback message. Never leaks raw backend message text. */
export async function getErrorMessageFromResponse(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const data = (await response.json().catch(() => undefined)) as
    | ReturnType<typeof getApiErrorBody>
    | undefined
  const synthetic = {
    response: {
      status: response.status,
      data,
    },
  }
  return getErrorMessage(synthetic, fallbackMessage)
}

/** Reads structured API errors and throws with `.status` attached (no backend message text). */
export async function throwHttpError(
  response: Response,
  fallback: string,
): Promise<never> {
  const data = (await response.json().catch(() => undefined)) as
    | ReturnType<typeof getApiErrorBody>
    | undefined
  const synthetic = {
    response: {
      status: response.status,
      data,
    },
  }
  const message = getErrorMessage(synthetic, fallback)
  throw createHttpError(message, response.status, data)
}
