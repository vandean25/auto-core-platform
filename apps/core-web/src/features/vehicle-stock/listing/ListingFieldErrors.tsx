import type { VehicleListingExportFieldIssue } from '@/api/vehicle-listing'

type Props = {
  issues: VehicleListingExportFieldIssue[]
  field: string
}

export function ListingFieldErrors({ issues, field }: Props) {
  const rows = issues.filter(
    (issue) => issue.field === field || issue.field.startsWith(`${field}.`),
  )
  if (rows.length === 0) {
    return null
  }
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-destructive">
      {rows.map((issue) => (
        <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
      ))}
    </ul>
  )
}
