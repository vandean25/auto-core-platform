import type { LegalEntityCountry } from '@prisma/client';
import { defaultProfileCodeForCountry } from '../../finance/accounting-profile/accounting-profile.codes.js';
import { computeSellerReadiness } from '../../site/legal-entity-readiness.js';
import {
  buildLegalEntitySellerUpdateData,
  type LegalEntitySellerRecord,
} from '../../site/legal-entity-seller.validation.js';
import { UnsupportedCountryError } from './country-pack.registry.js';

const unsupportedSeller: LegalEntitySellerRecord = {
  country_iso: 'FR' as LegalEntityCountry,
  name: 'Synthetic seller',
  address_street: 'Example Street 1',
  address_line2: null,
  address_zip: '1000',
  address_city: 'Example City',
  tax_number: null,
  vat_id: null,
  iban: null,
  bic: null,
  bank_name: null,
  email: null,
  phone: null,
  registration_number: null,
  registration_court: null,
  representatives: null,
  payment_terms_days: 14,
  payment_terms_text: 'Net 14',
};

describe('unsupported legal-entity country', () => {
  it('does not choose an Austrian accounting profile', () => {
    expect(() =>
      defaultProfileCodeForCountry(unsupportedSeller.country_iso),
    ).toThrow(UnsupportedCountryError);
  });

  it('does not apply Austrian seller readiness rules', () => {
    expect(() => computeSellerReadiness(unsupportedSeller)).toThrow(
      UnsupportedCountryError,
    );
  });

  it('does not apply Austrian seller identifier validation', () => {
    expect(() =>
      buildLegalEntitySellerUpdateData(unsupportedSeller, {}),
    ).toThrow(UnsupportedCountryError);
  });
});
