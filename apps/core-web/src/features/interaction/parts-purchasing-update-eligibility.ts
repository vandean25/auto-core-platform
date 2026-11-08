/**
 * ADR-0036 R1 eligibility for vendor field edits (AUT-884).
 * A patch is optimistic only when every field is descriptive and the client can compute the whole visible result.
 */

function onlyFields(patch: object, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(patch)
  return keys.length > 0 && keys.every((key) => allowed.has(key))
}

/**
 * Not eligible: `brandIds`. Supported brands are checked against the tenant catalogue,
 * and the server returns the brand records. The client only has ids.
 */
export const VENDOR_OPTIMISTIC_FIELDS: ReadonlySet<string> = new Set(['name', 'email', 'account_number'])

export const isVendorUpdateOptimisticEligible = ({ data }: { data: object }) =>
  onlyFields(data, VENDOR_OPTIMISTIC_FIELDS)
