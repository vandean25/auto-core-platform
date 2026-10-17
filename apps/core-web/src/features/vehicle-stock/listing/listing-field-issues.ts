import type { VehicleListingExportFieldIssue } from '@/api/vehicle-listing'

export function listingIssuesForField(
  issues: VehicleListingExportFieldIssue[],
  field: string,
): VehicleListingExportFieldIssue[] {
  return issues.filter(
    (issue) => issue.field === field || issue.field.startsWith(`${field}.`),
  )
}

export function mergeChannelValidationIssues(
  channels: Array<{ platform: string; issues: VehicleListingExportFieldIssue[] }>,
  platform: string,
): VehicleListingExportFieldIssue[] {
  const row = channels.find((channel) => channel.platform === platform)
  return row?.issues ?? []
}
