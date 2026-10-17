import { getErrorBody } from '@/lib/error-utils'
import { i18n } from '@/lib/i18n'

export const INSPECTION_CATALOGUE_ERROR_CODES = [
  'NOT_CONFIGURED',
  'UNKNOWN_CODE',
  'STALE_CATALOG',
  'OUT_OF_SCOPE',
  'SOURCE_CONFLICT',
  'REVIEW_REQUIRED',
  'UNSUPPORTED_SCHEMA_VERSION',
] as const

export type InspectionCatalogueErrorCode =
  (typeof INSPECTION_CATALOGUE_ERROR_CODES)[number]

function resolveInspectionCatalogueErrorCode(error: unknown): string | undefined {
  const body = getErrorBody(error)
  const messageCode =
    error instanceof Error &&
    INSPECTION_CATALOGUE_ERROR_CODES.includes(
      error.message as InspectionCatalogueErrorCode,
    )
      ? error.message
      : undefined
  const code = body?.code ?? messageCode
  if (
    code &&
    INSPECTION_CATALOGUE_ERROR_CODES.includes(code as InspectionCatalogueErrorCode)
  ) {
    return code
  }
  return undefined
}

export function describeInspectionCatalogueError(error: unknown): string {
  const code = resolveInspectionCatalogueErrorCode(error)
  if (code) {
    return i18n.t(`inspection.catalogueRef.errors.${code}`, { ns: 'workshop' })
  }
  return i18n.t('inspection.catalogueRef.errors.generic', { ns: 'workshop' })
}
