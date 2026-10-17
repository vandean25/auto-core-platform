import { translateApiError } from '@/api/api-error'
import { getErrorBody } from '@/lib/error-utils'
import { i18n } from '@/lib/i18n'

export const WORKSHOP_CHECK_IN_ERROR_CODES = [
  'CHECK_IN_EXISTS',
  'CHECK_IN_CONFLICT',
  'CHECK_IN_COMPLETED',
  'CHECK_IN_ORDER_STATUS',
  'CHECK_IN_MEDIA_INVALID',
  'CHECK_IN_MEDIA_UPLOADER_REQUIRED',
  'CHECK_IN_SIGNATURE_REQUIRED',
  'UPLOAD_ID_REUSED',
] as const

export type WorkshopCheckInErrorCode =
  (typeof WORKSHOP_CHECK_IN_ERROR_CODES)[number]

export function resolveWorkshopCheckInErrorCode(
  error: unknown,
): WorkshopCheckInErrorCode | undefined {
  const body = getErrorBody(error)
  const directCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined
  const code = body?.code ?? directCode
  if (
    code &&
    WORKSHOP_CHECK_IN_ERROR_CODES.includes(code as WorkshopCheckInErrorCode)
  ) {
    return code as WorkshopCheckInErrorCode
  }
  return undefined
}

export function describeWorkshopCheckInError(error: unknown): string {
  const code = resolveWorkshopCheckInErrorCode(error)
  if (code) {
    return translateApiError({
      response: { data: { code, ...(getErrorBody(error) ?? {}) } },
    })
  }
  return i18n.t('checkIn.errors.generic', { ns: 'workshop' })
}

export function createCheckInHttpError(
  response: Response,
  body: { message?: string | string[]; code?: string },
): Error & { status: number; code?: string; data?: { code?: string } } {
  const raw = body.message
  const message =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.join(', ')
        : 'Request failed'
  const err = new Error(message) as Error & {
    status: number
    code?: string
    data?: { code?: string }
  }
  err.status = response.status
  if (body.code) {
    err.code = body.code
    err.data = { code: body.code }
  }
  return err
}
