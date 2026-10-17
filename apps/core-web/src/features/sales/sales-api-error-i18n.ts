import type { TFunction } from 'i18next'
import { getErrorBody, getErrorCode, getErrorMessage, getErrorStatus } from '@/lib/error-utils'

const INSUFFICIENT_ATP_PATTERN =
  /^Insufficient ATP for item (.+) \(Req: ([^,]+), Available: (.+)\)$/

function appendReference(message: string, error: unknown): string {
  const status = getErrorStatus(error)
  if (status !== null && status >= 500) {
    const body = getErrorBody(error)
    const reference = body?.requestId || body?.eventId
    if (reference && !message.includes('(ref: ')) {
      return `${message} (ref: ${reference})`
    }
  }
  return message
}

function rawApiMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message) {
    return error.message
  }
  const body = getErrorBody(error)
  const raw = body?.message
  if (typeof raw === 'string' && raw.length > 0) {
    return raw
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.join(', ')
  }
  return undefined
}

function translateByCode(t: TFunction<'sales'>, code: string): string | undefined {
  const message = t(`errors.codes.${code}`, { defaultValue: '' })
  return message || undefined
}

/**
 * Maps known sales API error codes (and a few message shapes) to translated copy.
 * Never surfaces raw English server messages in the UI when a known mapping exists.
 */
export function translateSalesApiError(
  t: TFunction<'sales'>,
  error: unknown,
  fallbackKey: 'errors.generic' | 'errors.loadFailed' = 'errors.generic',
): string {
  const code = getErrorCode(error)
  if (code) {
    const byCode = translateByCode(t, code)
    if (byCode) {
      return appendReference(byCode, error)
    }
  }

  const message = rawApiMessage(error)
  if (message) {
    const atpMatch = INSUFFICIENT_ATP_PATTERN.exec(message)
    if (atpMatch) {
      return t('errors.insufficientAtp', {
        item: atpMatch[1],
        required: atpMatch[2],
        available: atpMatch[3],
      })
    }

    const codePrefix = /^([A-Z][A-Z0-9_]+):\s/.exec(message)
    if (codePrefix) {
      const byCode = translateByCode(t, codePrefix[1])
      if (byCode) {
        return appendReference(byCode, error)
      }
    }

    if (message.includes('Branded invoice issuance is disabled')) {
      const branding = translateByCode(t, 'INVOICE_BRANDING_WRITER_DISABLED')
      if (branding) {
        return appendReference(branding, error)
      }
    }
  }

  const fallback = t(fallbackKey)
  return appendReference(getErrorMessage(error, fallback), error)
}
