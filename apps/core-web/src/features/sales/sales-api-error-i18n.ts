import type { TFunction } from 'i18next'
import { normalizeApiError, translateApiError } from '@/api/api-error'

/**
 * Maps sales API errors to translated copy via the shared structured error decoder.
 */
export function translateSalesApiError(
  t: TFunction<'sales'>,
  error: unknown,
  fallbackKey: 'errors.generic' | 'errors.loadFailed' = 'errors.generic',
): string {
  if (normalizeApiError(error)?.code) {
    return translateApiError(error)
  }
  return t(fallbackKey)
}
