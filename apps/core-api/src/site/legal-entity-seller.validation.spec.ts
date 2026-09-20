import { BadRequestException } from '@nestjs/common';
import {
  buildLegalEntitySellerUpdateData,
  isValidAtUid,
  isValidBic,
  isValidDeTaxNumber,
  isValidDeVatId,
  isValidIban,
  normalizeOptionalString,
  type LegalEntitySellerRecord,
} from './legal-entity-seller.validation.js';

const baseEntity = (): LegalEntitySellerRecord => ({
  country_iso: 'AT',
  name: 'Example GmbH',
  address_street: null,
  address_line2: null,
  address_zip: null,
  address_city: null,
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
  payment_terms_days: null,
  payment_terms_text: null,
});

describe('legal-entity-seller.validation', () => {
  describe('normalizeOptionalString', () => {
    it('trims and preserves non-empty values', () => {
      expect(normalizeOptionalString('  Main Street  ')).toBe('Main Street');
    });

    it('returns null for blank strings', () => {
      expect(normalizeOptionalString('   ')).toBeNull();
    });
  });

  describe('format validators', () => {
    it('accepts a valid Austrian IBAN', () => {
      expect(isValidIban('AT611904300234573201')).toBe(true);
    });

    it('rejects an invalid IBAN checksum', () => {
      expect(isValidIban('AT611904300234573202')).toBe(false);
    });

    it('accepts a valid BIC', () => {
      expect(isValidBic('BKAUATWW')).toBe(true);
    });

    it('accepts a valid DE VAT ID', () => {
      expect(isValidDeVatId('DE123456789')).toBe(true);
    });

    it('accepts a valid AT UID', () => {
      expect(isValidAtUid('ATU12345678')).toBe(true);
    });

    it('accepts a valid DE tax number', () => {
      expect(isValidDeTaxNumber('12/345/67890')).toBe(true);
    });
  });

  describe('buildLegalEntitySellerUpdateData', () => {
    it('allows incomplete seller settings', () => {
      const data = buildLegalEntitySellerUpdateData(baseEntity(), {
        addressStreet: 'Hauptstraße 1',
      });

      expect(data.address_street).toBe('Hauptstraße 1');
    });

    it('normalizes blank optional strings to null', () => {
      const data = buildLegalEntitySellerUpdateData(baseEntity(), {
        addressLine2: '   ',
      });

      expect(data.address_line2).toBeNull();
    });

    it('rejects malformed AT UID values', () => {
      expect(() =>
        buildLegalEntitySellerUpdateData(baseEntity(), {
          vatId: 'AT123',
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects malformed IBAN values', () => {
      expect(() =>
        buildLegalEntitySellerUpdateData(baseEntity(), {
          iban: 'AT00INVALID',
        }),
      ).toThrow(BadRequestException);
    });

    it('rejects payment terms outside the allowed range', () => {
      expect(() =>
        buildLegalEntitySellerUpdateData(baseEntity(), {
          paymentTermsDays: 400,
        }),
      ).toThrow(BadRequestException);
    });

    it('validates DE tax identifiers', () => {
      const data = buildLegalEntitySellerUpdateData(
        { ...baseEntity(), country_iso: 'DE' },
        {
          taxNumber: '12/345/67890',
          vatId: 'DE123456789',
        },
      );

      expect(data.tax_number).toBe('12/345/67890');
      expect(data.vat_id).toBe('DE123456789');
    });
  });
});
