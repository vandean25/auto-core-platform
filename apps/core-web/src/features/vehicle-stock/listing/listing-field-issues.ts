import type { VehicleListingExportFieldIssue } from '@/api/vehicle-listing'

export function mergeChannelValidationIssues(
  channels: Array<{ platform: string; issues: VehicleListingExportFieldIssue[] }>,
  platform: string,
): VehicleListingExportFieldIssue[] {
  const row = channels.find((channel) => channel.platform === platform)
  return row?.issues ?? []
}
