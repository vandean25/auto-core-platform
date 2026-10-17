import type { TFunction } from 'i18next'
import { normalizeApiError, translateApiError } from '@/api/api-error'
import {
  getErrorBody,
  getErrorCode,
  getErrorMessage,
  getErrorStatus,
} from '@/lib/error-utils'

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

function translateBySalesCode(t: TFunction<'sales'>, code: string): string | undefined {
  const message = t(`errors.codes.${code}`, { defaultValue: '' })
  return message || undefined
}

/**
 * Maps sales API errors to translated copy. Structured wire codes use the global
 * `errors:codes.*` registry; legacy message shapes keep sales-namespace fallbacks.
 */
export function translateSalesApiError(
  t: TFunction<'sales'>,
  error: unknown,
  fallbackKey: 'errors.generic' | 'errors.loadFailed' = 'errors.generic',
): string {
  const wireCode = getErrorCode(error) ?? normalizeApiError(error)?.code
  if (wireCode) {
    const translated = translateApiError(error)
    if (translated) {
      return appendReference(translated, error)
    }
    const bySalesCode = translateBySalesCode(t, wireCode)
    if (bySalesCode) {
      return appendReference(bySalesCode, error)
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
      const synthetic = {
        response: { status: getErrorStatus(error) ?? 400, data: { code: codePrefix[1] } },
      }
      const byWire = translateApiError(synthetic)
      const bySalesCode = translateBySalesCode(t, codePrefix[1])
      const resolved = bySalesCode ?? byWire
      if (resolved) {
        return appendReference(resolved, error)
      }
    }

    if (message.includes('Branded invoice issuance is disabled')) {
      const branding = translateBySalesCode(t, 'INVOICE_BRANDING_WRITER_DISABLED')
      if (branding) {
        return appendReference(branding, error)
      }
    }

    return appendReference(message, error)
  }

  const fallback = t(fallbackKey)
  return appendReference(getErrorMessage(error, fallback), error)
}
