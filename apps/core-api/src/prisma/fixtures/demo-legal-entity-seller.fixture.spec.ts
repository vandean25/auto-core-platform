import { computeSellerReadiness } from '../../site/legal-entity-readiness.js';
import { DEFAULT_WORKSHOP_DEMO_SELLER_FIELDS } from './demo-legal-entity-seller.fixture.js';

describe('demo-legal-entity-seller.fixture', () => {
  it('provides a complete AT seller profile for default-workshop seed', () => {
    const readiness = computeSellerReadiness({
      country_iso: 'AT',
      name: 'Default Workshop',
      address_line2: null,
      tax_number: null,
      iban: null,
      bic: null,
      bank_name: null,
      email: null,
      phone: null,
      registration_number: null,
      registration_court: null,
      representatives: null,
      ...DEFAULT_WORKSHOP_DEMO_SELLER_FIELDS,
    });

    expect(readiness).toEqual({
      isReady: true,
      missingFields: [],
    });
  });
});
