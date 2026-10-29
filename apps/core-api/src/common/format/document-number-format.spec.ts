import { createDocumentNumberFormatter } from './document-number-format.js';

// Intl renders Austrian euro amounts with a non-breaking space between symbol and amount.
const NBSP = '\u00A0';

describe('createDocumentNumberFormatter', () => {
  describe('de-AT', () => {
    const numbers = createDocumentNumberFormatter('de-AT');

    it('prints amounts with a decimal comma and the euro symbol first', () => {
      expect(numbers.formatAmount('120.00')).toBe(`€${NBSP}120,00`);
    });

    it('uses a period as the thousands separator', () => {
      expect(numbers.formatAmount('1234.56')).toBe(`€${NBSP}1.234,56`);
    });

    it('drops trailing zeros and uses a comma for quantities', () => {
      expect(numbers.formatQuantity('1.500')).toBe('1,5');
      expect(numbers.formatQuantity('1.000')).toBe('1');
      expect(numbers.formatQuantity('0.250')).toBe('0,25');
    });

    it('prints rates without decimals', () => {
      expect(numbers.formatRate('20.00')).toBe('20');
      expect(numbers.formatRate('19.00')).toBe('19');
    });

    it('keeps the fraction digits the stored value carries', () => {
      expect(numbers.formatAmount('7.50')).toBe(`€${NBSP}7,50`);
      expect(numbers.formatQuantity('1.234')).toBe('1,234');
    });

    it('renders missing values as empty text', () => {
      expect(numbers.formatAmount(null)).toBe('');
      expect(numbers.formatQuantity(undefined)).toBe('');
    });

    it('falls back to the stored text for values that are not numbers', () => {
      expect(numbers.formatAmount('n/a')).toBe('n/a');
    });
  });

  describe('en-GB', () => {
    const numbers = createDocumentNumberFormatter('en-GB');

    it('keeps the English decimal point and comma thousands separator', () => {
      expect(numbers.formatAmount('120.00')).toBe('€120.00');
      expect(numbers.formatAmount('1234.56')).toBe('€1,234.56');
      expect(numbers.formatQuantity('1.500')).toBe('1.5');
      expect(numbers.formatRate('20.00')).toBe('20');
    });
  });
});
