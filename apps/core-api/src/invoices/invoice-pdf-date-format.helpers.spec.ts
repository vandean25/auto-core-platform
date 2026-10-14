import {
  createInvoicePdfDateFormatter,
  formatInvoicePdfDate,
} from './invoice-pdf-date-format.helpers.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

const createSnapshot = (): InvoiceSnapshot => ({
  id: 'invoice-1',
  invoice_number: 'RE-2026-0001',
  date: '2026-04-07',
  due_date: '2026-04-14',
  total_net: '100.00',
  total_tax: '20.00',
  total_gross: '120.00',
  notes: 'Test note',
  tax_mode: 'STANDARD',
  customer: {
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: null,
    phone: null,
    vat_id: null,
    address_street: null,
    address_city: 'Wien',
    address_zip: '1010',
    address_country: null,
  },
  vehicle: null,
  items: [
    {
      description: 'Service',
      quantity: '1',
      unit_price: '100.00',
      tax_rate: '20',
      line_discount_type: null,
      line_discount_value: null,
      line_total: '100.00',
      revenue_group_name: null,
    },
  ],
  snapshot_created_at: '2026-04-07T12:00:00.000Z',
});

const createDachSnapshot = (): InvoiceSnapshot => ({
  ...createSnapshot(),
  schema_version: 2,
  seller: {
    name: 'E2E GmbH',
    country_iso: 'DE',
    address_street: 'Hauptstraße 1',
    address_line2: null,
    address_zip: '10115',
    address_city: 'Berlin',
    tax_number: null,
    vat_id: 'DE123456789',
    iban: null,
    bic: null,
    bank_name: null,
    email: null,
    phone: null,
    registration_number: null,
    registration_court: null,
    representatives: null,
  },
});

describe('formatInvoicePdfDate', () => {
  it('formats date strings as ISO yyyy-mm-dd outside the DACH layout', () => {
    expect(formatInvoicePdfDate('2026-04-07T12:00:00.000Z', false)).toBe(
      '2026-04-07',
    );
  });

  it('formats Date instances as ISO yyyy-mm-dd outside the DACH layout', () => {
    expect(
      formatInvoicePdfDate(new Date('2026-04-07T12:00:00.000Z'), false),
    ).toBe('2026-04-07');
  });

  it('formats dates as dd.mm.yyyy inside the DACH layout', () => {
    // Built from local calendar fields so the expectation holds in any runner timezone.
    expect(formatInvoicePdfDate(new Date(2026, 3, 7, 12), true)).toBe(
      '07.04.2026',
    );
  });

  it('echoes values that are not parseable dates', () => {
    expect(formatInvoicePdfDate('not-a-date', false)).toBe('not-a-date');
    expect(formatInvoicePdfDate('not-a-date', true)).toBe('not-a-date');
  });
});

describe('createInvoicePdfDateFormatter', () => {
  it('uses ISO dates for standard invoices', () => {
    const formatDate = createInvoicePdfDateFormatter(createSnapshot());

    expect(formatDate('2026-04-07T12:00:00.000Z')).toBe('2026-04-07');
  });

  it('uses German dates for DACH Rechnung snapshots', () => {
    const formatDate = createInvoicePdfDateFormatter(createDachSnapshot());

    expect(formatDate(new Date(2026, 3, 7, 12))).toBe('07.04.2026');
  });
});
