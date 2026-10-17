import type { TFunction } from 'i18next'
import { getErrorMessage } from '@/lib/error-utils'

/**
 * Maps sales API errors to translated copy via the shared wire-code resolver.
 */
export function translateSalesApiError(
  t: TFunction<'sales'>,
  error: unknown,
  fallbackKey: 'errors.generic' | 'errors.loadFailed' = 'errors.generic',
): string {
  return getErrorMessage(error, t(fallbackKey))
}
