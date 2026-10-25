import { i18n } from '@/lib/i18n'
import { fetchWithAuth } from "./client";
import {
  PUBLIC_API_ERROR_CODE_PARAMS,
  type PublicApiErrorCode,
} from '@/api/generated/public-error-codes'

export type ApiErrorViolation = {
  field: string
  code?: string
}

export type NormalizedApiError = {
  status: number | null
  code: string | null
  params: Record<string, string>
  violations: ApiErrorViolation[]
  requestId: string | null
  eventId: string | null
}

export type ApiErrorBody = {
  statusCode?: number
  message?: string | string[]
  code?: string
  params?: Record<string, unknown>
  orderId?: string
  orderNumber?: string
  eventId?: string
  requestId?: string
  field_issues?: ApiErrorViolation[]
}

type ApiErrorCarrier = {
  message?: string | string[]
  name?: string
  status?: number
  eventId?: string
  data?: ApiErrorBody
  response?: {
    status?: number
    data?: ApiErrorBody
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function getApiErrorBody(error: unknown): ApiErrorBody | undefined {
  if (!isRecord(error)) {
    return undefined
  }
  const carrier = error as ApiErrorCarrier
  return carrier.response?.data ?? carrier.data
}

function pickAllowedParams(
  code: string,
  body: ApiErrorBody,
): Record<string, string> {
  const allowed =
    PUBLIC_API_ERROR_CODE_PARAMS[code as PublicApiErrorCode] ?? []
  const params: Record<string, string> = {}

  if (isRecord(body.params)) {
    for (const key of allowed) {
      const value = body.params[key]
      if (typeof value === 'string') {
        params[key] = value
      }
    }
  }

  for (const key of allowed) {
    if (params[key]) continue
    const topLevel = body[key as keyof ApiErrorBody]
    if (typeof topLevel === 'string') {
      params[key] = topLevel
    }
  }

  return params
}

export function normalizeApiError(error: unknown): NormalizedApiError | null {
  const body = getApiErrorBody(error)
  if (!body && isRecord(error)) {
    const carrier = error as ApiErrorCarrier
    const status = carrier.response?.status ?? carrier.status ?? null
    if (status === null) {
      return null
    }
    return {
      status,
      code: null,
      params: {},
      violations: [],
      requestId: null,
      eventId: carrier.eventId ?? null,
    }
  }

  if (!body) {
    return null
  }

  const carrier = isRecord(error) ? (error as ApiErrorCarrier) : undefined
  const status =
    carrier?.response?.status ??
    carrier?.status ??
    body.statusCode ??
    null
  const code = typeof body.code === 'string' ? body.code : null
  const params = code ? pickAllowedParams(code, body) : {}
  const violations = Array.isArray(body.field_issues)
    ? body.field_issues
        .filter((row) => row && typeof row.field === 'string')
        .map((row) => ({
          field: row.field,
          code: typeof row.code === 'string' ? row.code : undefined,
        }))
    : []

  return {
    status,
    code,
    params,
    violations,
    requestId: typeof body.requestId === "string" ? body.requestId : null,
    eventId:
      typeof body.eventId === "string"
        ? body.eventId
        : (carrier?.eventId ?? null),
  };
}

function appendSupportReference(
  message: string,
  normalized: NormalizedApiError,
): string {
  if (normalized.status !== null && normalized.status >= 500) {
    const reference = normalized.requestId || normalized.eventId
    if (reference && !message.includes('(ref: ')) {
      return `${message} (ref: ${reference})`
    }
  }
  return message
}

/**
 * Maps a structured API error code to translated copy. Never uses backend `message` text.
 */
export function translateApiError(
  error: unknown,
  fallbackKey: 'errors:generic.unexpected' = 'errors:generic.unexpected',
): string {
  const normalized = normalizeApiError(error)
  if (!normalized) {
    return i18n.t(fallbackKey)
  }

  if (normalized.code) {
    const key = `errors:codes.${normalized.code}`
    const translated = i18n.t(key, {
      defaultValue: '',
      ...normalized.params,
    })
    if (translated) {
      return appendSupportReference(translated, normalized)
    }
  }

  const generic = i18n.t(fallbackKey)
  return appendSupportReference(generic, normalized)
}

export async function parseApiErrorResponse(
  response: Response,
): Promise<NormalizedApiError> {
  const payload = (await response.json().catch(() => undefined)) as
    | ApiErrorBody
    | undefined
  const synthetic = { response: { status: response.status, data: payload } }
  return (
    normalizeApiError(synthetic) ?? {
      status: response.status,
      code: null,
      params: {},
      violations: [],
      requestId: null,
      eventId: null,
    }
  )
}

export async function fetchJsonWithAuth<T>(
  input: RequestInfo | URL,
  fallbackMessage: string,
  init?: RequestInit,
): Promise<T> {
  const response = await (init === undefined
    ? fetchWithAuth(input)
    : fetchWithAuth(input, init));
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      { message?: string } | undefined;
    const message = payload?.message || fallbackMessage;
    const err = new Error(message) as Error & { status: number };
    err.status = response.status;
    throw err;
  }
  return response.json() as Promise<T>;
}
