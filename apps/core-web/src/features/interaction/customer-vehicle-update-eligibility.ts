/**
 * ADR-0036 R1 eligibility for customer, vehicle and dealer-stock field edits (AUT-883).
 * A patch is optimistic only when every field in it is descriptive and the client can compute the whole visible result.
 * Anything with a server-side effect beyond the stored value stays server-confirmed.
 */

function onlyFields(patch: object, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(patch)
  return keys.length > 0 && keys.every((key) => allowed.has(key))
}

/** Not eligible: `type`, `vat_id` (tax treatment) and `email` (a change resets the e-mail consent flag server-side). */
export const CUSTOMER_OPTIMISTIC_FIELDS: ReadonlySet<string> = new Set([
  'first_name',
  'last_name',
  'company_name',
  'phone',
  'address_street',
  'address_city',
  'address_zip',
  'address_country',
])

/** Not eligible: `vin` (identity resolution), `customer_id` (party records), registration/NoVA/CO2 inputs. */
export const VEHICLE_OPTIMISTIC_FIELDS: ReadonlySet<string> = new Set(['make', 'model', 'year', 'engine_code', 'plate'])

/** Not eligible: location, reservation (shared resources) and the NoVA/CO2/first-registration inputs (tax and due dates). */
export const VEHICLE_STOCK_OPTIMISTIC_FIELDS: ReadonlySet<string> = new Set([
  'color',
  'key_number',
  'mileage',
  'registration_certificate_no',
])

export const isCustomerUpdateOptimisticEligible = ({ data }: { data: object }) =>
  onlyFields(data, CUSTOMER_OPTIMISTIC_FIELDS)

export const isVehicleUpdateOptimisticEligible = ({ data }: { data: object }) =>
  onlyFields(data, VEHICLE_OPTIMISTIC_FIELDS)

export const isVehicleStockPatchOptimisticEligible = (patch: object) =>
  onlyFields(patch, VEHICLE_STOCK_OPTIMISTIC_FIELDS)
