import { escapeHtml } from '../common/pdf/pdf-layout';
import {
  buildInvoiceCustomerSection,
  buildInvoiceDocumentStyles,
  buildInvoiceFooterTemplate,
  buildInvoiceHeader,
  buildInvoiceHtmlDocument,
  buildInvoiceItemsTable,
  buildInvoiceMetaSection,
  buildInvoiceNotesSection,
  buildInvoiceTotalsSection,
  buildInvoiceVehicleSection,
} from './invoice-pdf.layout';
import type { InvoiceSnapshot } from './invoice-snapshot';

describe('invoice-pdf.layout', () => {
  const createSnapshot = (): InvoiceSnapshot => ({
    id: 'invoice-1',
    invoice_number: 'RE-2026-0001',
    date: '2026-04-07',
    due_date: '2026-04-14',
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    notes: 'Payment within 14 days',
    tax_mode: 'STANDARD',
    customer: {
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
      phone: '+43123456',
      vat_id: null,
      address_street: 'Teststraße 1',
      address_city: 'Wien',
      address_zip: '1010',
      address_country: 'Austria',
    },
    vehicle: {
      make: 'VW',
      model: 'Golf',
      year: '2020',
      plate: 'W-1234X',
      vin: 'WVWZZZ1234567890',
    },
    items: [
      {
        description: 'Oil change service',
        quantity: '1',
        unit_price: '100.00',
        tax_rate: '20',
        line_discount_type: null,
        line_discount_value: null,
        line_total: '100.00',
        revenue_group_name: 'Service',
      },
    ],
    snapshot_created_at: '2026-04-07T12:00:00.000Z',
  });

  const formatDate = (val: string | Date) =>
    typeof val === 'string' ? val : val.toISOString().slice(0, 10);

  describe('buildInvoiceDocumentStyles', () => {
    it('composes base PDF styles and shared table primitives', () => {
      const styles = buildInvoiceDocumentStyles();
      expect(styles).toContain('box-sizing: border-box');
      expect(styles).toContain('border-collapse: collapse');
      expect(styles).toContain('display: table-header-group');
      expect(styles).toContain('break-inside: avoid');
      expect(styles).toContain('.totals');
      expect(styles).toContain('table-layout: fixed');
    });
  });

  describe('buildInvoiceFooterTemplate', () => {
    it('uses shared buildPdfFooterTemplate primitive with invoice prefix', () => {
      const footer = buildInvoiceFooterTemplate('RE-2026-0001', escapeHtml);
      expect(footer).toContain('Invoice RE-2026-0001');
      expect(footer).toContain('class="pageNumber"');
      expect(footer).toContain('class="totalPages"');
    });
  });

  describe('buildInvoiceHeader', () => {
    it('renders header with escaped invoice number', () => {
      const header = buildInvoiceHeader('RE-2026-0001', escapeHtml);
      expect(header).toContain('<h1>Invoice</h1>');
      expect(header).toContain('RE-2026-0001');
    });
  });

  describe('buildInvoiceCustomerSection', () => {
    it('renders private customer details', () => {
      const html = buildInvoiceCustomerSection(createSnapshot(), escapeHtml);
      expect(html).toContain('Ada Lovelace');
      expect(html).toContain('Teststraße 1');
      expect(html).toContain('1010 Wien');
    });

    it('renders company name for COMPANY type customer', () => {
      const snapshot = createSnapshot();
      snapshot.customer.type = 'COMPANY';
      snapshot.customer.company_name = 'Ada Corp';
      const html = buildInvoiceCustomerSection(snapshot, escapeHtml);
      expect(html).toContain('Ada Corp');
    });
  });

  describe('buildInvoiceMetaSection', () => {
    it('renders metadata with formatted dates', () => {
      const html = buildInvoiceMetaSection(
        createSnapshot(),
        'RE-2026-0001',
        escapeHtml,
        formatDate,
      );
      expect(html).toContain('RE-2026-0001');
      expect(html).toContain('2026-04-07');
      expect(html).toContain('2026-04-14');
    });
  });

  describe('buildInvoiceVehicleSection', () => {
    it('returns empty string when vehicle is null', () => {
      const snapshot = createSnapshot();
      snapshot.vehicle = null;
      expect(buildInvoiceVehicleSection(snapshot, escapeHtml)).toBe('');
    });

    it('renders vehicle make, model, year, plate, and VIN', () => {
      const html = buildInvoiceVehicleSection(createSnapshot(), escapeHtml);
      expect(html).toContain('VW Golf (2020)');
      expect(html).toContain('W-1234X');
      expect(html).toContain('WVWZZZ1234567890');
    });
  });

  describe('buildInvoiceItemsTable', () => {
    it('renders item row details', () => {
      const html = buildInvoiceItemsTable(createSnapshot(), escapeHtml);
      expect(html).toContain('Oil change service');
      expect(html).toContain('100.00');
    });
  });

  describe('buildInvoiceTotalsSection', () => {
    it('renders standard tax breakdown', () => {
      const html = buildInvoiceTotalsSection(createSnapshot(), escapeHtml);
      expect(html).toContain('Net:');
      expect(html).toContain('Tax:');
      expect(html).toContain('Gross:');
      expect(html).toContain('120.00');
    });

    it('renders margin scheme legal notice when tax_mode is MARGIN_SCHEME', () => {
      const snapshot = createSnapshot();
      snapshot.tax_mode = 'MARGIN_SCHEME';
      const html = buildInvoiceTotalsSection(snapshot, escapeHtml);
      expect(html).toContain('Differenzbesteuerung gemäß § 24 UStG');
      expect(html).not.toContain('Net:');
    });
  });

  describe('buildInvoiceNotesSection', () => {
    it('renders notes when present', () => {
      const html = buildInvoiceNotesSection(createSnapshot(), escapeHtml);
      expect(html).toContain('Payment within 14 days');
    });

    it('returns empty string when notes are null', () => {
      const snapshot = createSnapshot();
      snapshot.notes = null;
      expect(buildInvoiceNotesSection(snapshot, escapeHtml)).toBe('');
    });
  });

  describe('buildInvoiceHtmlDocument', () => {
    it('assembles complete invoice HTML document', () => {
      const html = buildInvoiceHtmlDocument(
        createSnapshot(),
        'RE-2026-0001',
        escapeHtml,
        formatDate,
      );
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<h1>Invoice</h1>');
      expect(html).toContain('RE-2026-0001');
    });
  });
});
