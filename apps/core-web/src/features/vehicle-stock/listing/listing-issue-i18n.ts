import type { TFunction } from 'i18next'
import type { VehicleListingExportFieldIssue } from '@/api/vehicle-listing'
import { getErrorBody } from '@/lib/error-utils'

export type ListingApiFieldIssue = VehicleListingExportFieldIssue

export function getListingFieldIssuesFromError(error: unknown): ListingApiFieldIssue[] {
  const body = getErrorBody(error) as { field_issues?: ListingApiFieldIssue[] } | undefined
  if (!body?.field_issues || !Array.isArray(body.field_issues)) {
    return []
  }
  return body.field_issues
}

export function translateListingIssue(
  t: TFunction<'vehicleStock'>,
  issue: VehicleListingExportFieldIssue,
): string {
  if (issue.code) {
    const byCode = t(`listing.validation.${issue.code}`, {
      defaultValue: '',
      field: issue.field,
    })
    if (byCode) {
      return byCode
    }
  }
  const byField = t(`listing.validation.fields.${issue.field}`, {
    defaultValue: '',
  })
  if (byField) {
    return byField
  }
  return t('listing.validation.unknown')
}

export function translateListingErrorCode(
  t: TFunction<'vehicleStock'>,
  code: string | undefined,
): string {
  if (!code) {
    return t('listing.errors.generic')
  }
  const message = t(`listing.errors.codes.${code}`, { defaultValue: '' })
  return message || t('listing.errors.generic')
}
