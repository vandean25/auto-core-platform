import { BadRequestException } from '@nestjs/common';
import {
  assertCustomerVatIdFormat,
  CUSTOMER_VAT_ID_INVALID_CODE,
  normalizeCustomerVatId,
} from './customer-vat-id.validation.js';

describe('customer-vat-id.validation', () => {
  describe('normalizeCustomerVatId', () => {
    it('uppercases and strips whitespace', () => {
      expect(normalizeCustomerVatId('  atu12345678 ')).toBe('ATU12345678');
      expect(normalizeCustomerVatId('atu 1234 5678')).toBe('ATU12345678');
    });

    it('returns null for blank values', () => {
      expect(normalizeCustomerVatId('   ')).toBeNull();
    });
  });

  describe('assertCustomerVatIdFormat', () => {
    it('accepts valid AT and DE fixtures', () => {
      expect(() =>
        assertCustomerVatIdFormat('AT', 'ATU12345678'),
      ).not.toThrow();
      expect(() =>
        assertCustomerVatIdFormat('DE', 'DE123456789'),
      ).not.toThrow();
    });

    it('skips validation when vat_id is omitted', () => {
      expect(() => assertCustomerVatIdFormat('AT', null)).not.toThrow();
    });

    it('rejects invalid AT UID with stable code and field pointer', () => {
      try {
        assertCustomerVatIdFormat('AT', 'AT123');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({
            code: CUSTOMER_VAT_ID_INVALID_CODE,
            field: 'vat_id',
          }),
        );
        return;
      }
      throw new Error('expected BadRequestException');
    });

    it('rejects invalid DE USt-IdNr with stable code and field pointer', () => {
      try {
        assertCustomerVatIdFormat('DE', 'DE123');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({
            code: CUSTOMER_VAT_ID_INVALID_CODE,
            field: 'vat_id',
          }),
        );
        return;
      }
      throw new Error('expected BadRequestException');
    });

    it('does not validate format for non AT/DE countries', () => {
      expect(() =>
        assertCustomerVatIdFormat('CH', 'not-a-vat-id'),
      ).not.toThrow();
    });
  });
});
