import { computeSellerReadiness } from './legal-entity-readiness.js';
import type { LegalEntitySellerRecord } from './legal-entity-seller.validation.js';

const baseEntity = (
  overrides: Partial<LegalEntitySellerRecord> = {},
): LegalEntitySellerRecord => ({
  country_iso: 'AT',
  name: 'Example GmbH',
  address_street: 'Hauptstraße 1',
  address_line2: null,
  address_zip: '1010',
  address_city: 'Wien',
  tax_number: null,
  vat_id: 'ATU12345678',
  iban: null,
  bic: null,
  bank_name: null,
  email: null,
  phone: null,
  registration_number: null,
  registration_court: null,
  representatives: null,
  payment_terms_days: 14,
  payment_terms_text: 'Payable within 14 days',
  ...overrides,
});

describe('legal-entity-readiness', () => {
  it('marks a complete AT profile as ready', () => {
    expect(computeSellerReadiness(baseEntity())).toEqual({
      isReady: true,
      missingFields: [],
    });
  });

  it('requires DE tax number or VAT ID', () => {
    const readiness = computeSellerReadiness(
      baseEntity({
        country_iso: 'DE',
        vat_id: null,
        tax_number: null,
      }),
    );

    expect(readiness.isReady).toBe(false);
    expect(readiness.missingFields).toContain('tax_number_or_vat_id');
  });

  it('accepts DE readiness with only a tax number', () => {
    const readiness = computeSellerReadiness(
      baseEntity({
        country_iso: 'DE',
        vat_id: null,
        tax_number: '12/345/67890',
      }),
    );

    expect(readiness.isReady).toBe(true);
  });

  it('requires both payment term fields', () => {
    const readiness = computeSellerReadiness(
      baseEntity({
        payment_terms_days: null,
        payment_terms_text: null,
      }),
    );

    expect(readiness.missingFields).toContain('payment_terms_days');
    expect(readiness.missingFields).toContain('payment_terms_text');
  });

  it('requires payment terms text even when days are set', () => {
    const readiness = computeSellerReadiness(
      baseEntity({
        payment_terms_days: 14,
        payment_terms_text: null,
      }),
    );

    expect(readiness.isReady).toBe(false);
    expect(readiness.missingFields).toContain('payment_terms_text');
  });
});
