import { getErrorBody } from '@/lib/error-utils'
import { i18n } from '@/lib/i18n'

export const WORKSHOP_CHECK_IN_ERROR_CODES = [
  'CHECK_IN_EXISTS',
  'CHECK_IN_CONFLICT',
  'CHECK_IN_COMPLETED',
  'CHECK_IN_ORDER_STATUS',
  'CHECK_IN_MEDIA_INVALID',
  'UPLOAD_ID_REUSED',
  'CHECK_IN_NOT_COMPLETED',
  'CHECK_IN_MEDIA_PENDING',
] as const

export type WorkshopCheckInErrorCode =
  (typeof WORKSHOP_CHECK_IN_ERROR_CODES)[number]

function resolveCheckInErrorCode(error: unknown): WorkshopCheckInErrorCode | undefined {
  const body = getErrorBody(error)
  const code = body?.code
  if (
    code &&
    WORKSHOP_CHECK_IN_ERROR_CODES.includes(code as WorkshopCheckInErrorCode)
  ) {
    return code as WorkshopCheckInErrorCode
  }
  return undefined
}

function messageForCode(code: WorkshopCheckInErrorCode): string {
  return i18n.t(`checkIn.errors.${code}`, { ns: 'workshop' })
}

export function describeWorkshopCheckInError(error: unknown): string {
  const code = resolveCheckInErrorCode(error)
  if (code) {
    return messageForCode(code)
  }
  return i18n.t('checkIn.errors.generic', { ns: 'workshop' })
}

export function createCheckInHttpError(
  response: Response,
  body: { message?: string | string[]; code?: string },
): Error & { status: number; code?: string } {
  const raw = body.message
  const message =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.join(', ')
        : 'Request failed'
  const err = new Error(message) as Error & { status: number; code?: string }
  err.status = response.status
  if (body.code) {
    err.code = body.code
  }
  return err
}
