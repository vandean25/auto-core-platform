import type { ListingSerializerFieldIssue } from './listing-serializer.types.js';

export function formatListingExportValidationMessage(
  issues: ListingSerializerFieldIssue[],
): string {
  const fields = [...new Set(issues.map((issue) => issue.field))].sort();
  if (fields.length === 0) {
    return 'Listing export validation failed.';
  }
  return `Listing export validation failed (${fields.join(', ')}).`;
}
