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

function resolveInspectionCatalogueErrorCode(error: unknown): InspectionCatalogueErrorCode | undefined {
  const body = getErrorBody(error)
  const messageCode =
    error instanceof Error &&
    INSPECTION_CATALOGUE_ERROR_CODES.includes(
      error.message as InspectionCatalogueErrorCode,
    )
      ? (error.message as InspectionCatalogueErrorCode)
      : undefined
  const code = body?.code ?? messageCode
  if (
    code &&
    INSPECTION_CATALOGUE_ERROR_CODES.includes(code as InspectionCatalogueErrorCode)
  ) {
    return code as InspectionCatalogueErrorCode
  }
  return undefined
}

function messageForCode(code: InspectionCatalogueErrorCode): string {
  switch (code) {
    case 'NOT_CONFIGURED':
      return i18n.t('inspection.catalogueRef.errors.NOT_CONFIGURED', { ns: 'workshop' })
    case 'UNKNOWN_CODE':
      return i18n.t('inspection.catalogueRef.errors.UNKNOWN_CODE', { ns: 'workshop' })
    case 'STALE_CATALOG':
      return i18n.t('inspection.catalogueRef.errors.STALE_CATALOG', { ns: 'workshop' })
    case 'OUT_OF_SCOPE':
      return i18n.t('inspection.catalogueRef.errors.OUT_OF_SCOPE', { ns: 'workshop' })
    case 'SOURCE_CONFLICT':
      return i18n.t('inspection.catalogueRef.errors.SOURCE_CONFLICT', { ns: 'workshop' })
    case 'REVIEW_REQUIRED':
      return i18n.t('inspection.catalogueRef.errors.REVIEW_REQUIRED', { ns: 'workshop' })
    case 'UNSUPPORTED_SCHEMA_VERSION':
      return i18n.t('inspection.catalogueRef.errors.UNSUPPORTED_SCHEMA_VERSION', {
        ns: 'workshop',
      })
  }
}

export function describeInspectionCatalogueError(error: unknown): string {
  const code = resolveInspectionCatalogueErrorCode(error)
  if (code) {
    return messageForCode(code)
  }
  return i18n.t('inspection.catalogueRef.errors.generic', { ns: 'workshop' })
}
