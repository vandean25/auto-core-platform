import {
  getApiErrorBody,
  normalizeApiError,
  translateApiError,
} from '@/api/api-error'
import { wireCodeForHttpStatus } from '@/api/http-status-fallback-codes'

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

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (!isObjectLike(error)) {
    return fallbackMessage
  }

  const wireCode = resolveWireErrorCode(error)
  const normalized = normalizeApiError(error)

  if (wireCode) {
    return appendServerReference(
      translateApiError(
        syntheticErrorForTranslation(error, wireCode),
        'errors:generic.unexpected',
      ),
      normalized,
      (error as ApiErrorLike).eventId,
    )
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
export type HttpError = Error & {
  status: number
  response?: {
    status: number
    data?: ReturnType<typeof getApiErrorBody>
  }
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
