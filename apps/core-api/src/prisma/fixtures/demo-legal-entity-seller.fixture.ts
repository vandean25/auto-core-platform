/**
 * Seller identity for the `default-workshop` demo legal entity (AUT-309).
 *
 * Fictional AT address and UID for local seed / UAT — not a real company.
 * After `npx prisma db seed` (wipe + reseed), no manual Settings step is required
 * for seller readiness; accounting profile is seeded separately (AUT-314).
 */
export const DEFAULT_WORKSHOP_DEMO_SELLER_FIELDS = {
  address_street: 'Hauptstraße 1',
  address_zip: '1010',
  address_city: 'Wien',
  vat_id: 'ATU12345678',
  payment_terms_days: 14,
  payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
} as const;
