import { isInvoiceSnapshot, parseInvoiceSnapshot } from './invoice-snapshot.validation';
import type { InvoiceSnapshot } from './invoice-snapshot';

const validSnapshot: InvoiceSnapshot = {
  id: 'inv-1',
  invoice_number: 'INV-001',
  date: '2026-01-01T00:00:00.000Z',
  due_date: '2026-01-15T00:00:00.000Z',
  total_net: '100.00',
  total_tax: '20.00',
  total_gross: '120.00',
  notes: 'Thank you',
  tax_mode: 'STANDARD',
  customer: {
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    phone: null,
    vat_id: null,
    address_street: '1 Main St',
    address_city: 'Berlin',
    address_zip: '10115',
    address_country: 'DE',
  },
  vehicle: {
    make: 'VW',
    model: 'Golf',
    year: 2020,
    engine_code: null,
    vin: 'WVWZZZ1KZAW000000',
    plate: 'B-AB 1234',
  },
  items: [
    {
      description: 'Service',
      quantity: '1.00',
      unit_price: '100.00',
      tax_rate: '20.00',
      line_discount_type: null,
      line_discount_value: null,
      line_total: '120.00',
      revenue_group_name: null,
    },
  ],
  snapshot_created_at: '2026-01-01T12:00:00.000Z',
};

describe('invoice-snapshot.validation', () => {
  describe('isInvoiceSnapshot', () => {
    it('accepts a fully valid snapshot', () => {
      expect(isInvoiceSnapshot(validSnapshot)).toBe(true);
    });

    it('accepts null vehicle and omitted tax_mode', () => {
      const snapshot = {
        ...validSnapshot,
        tax_mode: undefined,
        vehicle: null,
      };

      expect(isInvoiceSnapshot(snapshot)).toBe(true);
    });

    it('accepts MARGIN_SCHEME tax mode', () => {
      expect(
        isInvoiceSnapshot({ ...validSnapshot, tax_mode: 'MARGIN_SCHEME' }),
      ).toBe(true);
    });

    it('rejects non-objects', () => {
      expect(isInvoiceSnapshot(null)).toBe(false);
      expect(isInvoiceSnapshot(undefined)).toBe(false);
      expect(isInvoiceSnapshot('snapshot')).toBe(false);
      expect(isInvoiceSnapshot([])).toBe(false);
    });

    it('rejects missing required top-level string fields', () => {
      expect(isInvoiceSnapshot({ ...validSnapshot, id: 1 })).toBe(false);
      expect(isInvoiceSnapshot({ ...validSnapshot, date: null })).toBe(false);
      expect(isInvoiceSnapshot({ ...validSnapshot, total_net: 100 })).toBe(
        false,
      );
    });

    it('rejects invalid tax_mode values', () => {
      expect(isInvoiceSnapshot({ ...validSnapshot, tax_mode: 'EXEMPT' })).toBe(
        false,
      );
    });

    it('rejects invalid customer shape', () => {
      expect(
        isInvoiceSnapshot({
          ...validSnapshot,
          customer: { ...validSnapshot.customer, type: 'GOVERNMENT' },
        }),
      ).toBe(false);

      expect(
        isInvoiceSnapshot({
          ...validSnapshot,
          customer: { ...validSnapshot.customer, first_name: null },
        }),
      ).toBe(false);
    });

    it('rejects invalid vehicle shape when present', () => {
      expect(
        isInvoiceSnapshot({
          ...validSnapshot,
          vehicle: { ...validSnapshot.vehicle, year: '2020' },
        }),
      ).toBe(false);

      expect(
        isInvoiceSnapshot({
          ...validSnapshot,
          vehicle: { make: 'VW' },
        }),
      ).toBe(false);
    });

    it('rejects non-array or malformed items', () => {
      expect(isInvoiceSnapshot({ ...validSnapshot, items: null })).toBe(false);
      expect(isInvoiceSnapshot({ ...validSnapshot, items: [{}] })).toBe(false);
      expect(
        isInvoiceSnapshot({
          ...validSnapshot,
          items: [{ ...validSnapshot.items[0], quantity: 1 }],
        }),
      ).toBe(false);
    });

    it('rejects missing snapshot_created_at', () => {
      const { snapshot_created_at: _ignored, ...withoutTimestamp } =
        validSnapshot;

      expect(isInvoiceSnapshot(withoutTimestamp)).toBe(false);
    });
  });

  describe('parseInvoiceSnapshot', () => {
    it('returns the snapshot when valid', () => {
      expect(parseInvoiceSnapshot(validSnapshot)).toEqual(validSnapshot);
    });

    it('returns null when invalid', () => {
      expect(parseInvoiceSnapshot({ id: 'partial' })).toBeNull();
      expect(parseInvoiceSnapshot(null)).toBeNull();
    });
  });
});
