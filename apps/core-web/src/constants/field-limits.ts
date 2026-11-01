/**
 * Character caps the API enforces on these fields. The form sends `maxLength` so a user cannot type past a limit the
 * backend would refuse with an untranslated validation error. Keep in step with the DTOs in `core-api`.
 */
export const INSPECTION_NOTES_MAX_LENGTH = 2000

export const CUSTOMER_FIELD_MAX_LENGTH = {
  company_name: 200,
  first_name: 120,
  last_name: 120,
  email: 254,
  phone: 40,
  vat_id: 32,
  address_street: 200,
  address_city: 120,
  address_zip: 20,
  address_country: 100,
} as const

export type CustomerField = keyof typeof CUSTOMER_FIELD_MAX_LENGTH
