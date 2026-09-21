import { escapeHtml } from '../common/pdf/pdf-layout.js';
import {
  buildInvoiceCustomerSection,
  buildInvoiceDocumentStyles,
  buildInvoiceFooterTemplate,
  buildInvoiceHeader,
  buildInvoiceHtmlDocument,
  buildInvoiceItemsTable,
  buildInvoiceMetaSection,
  buildInvoiceNotesSection,
  buildInvoiceSellerSection,
  buildInvoiceTaxBreakdownSection,
  buildInvoiceTotalsSection,
  buildInvoiceVehicleSection,
  isDachRechnungSnapshot,
  resolveMarginSchemeLegalNote,
} from './invoice-pdf.layout.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

describe('invoice-pdf.layout', () => {
  const createV2Seller = () => ({
    name: 'E2E GmbH',
    country_iso: 'DE' as const,
    address_street: 'Hauptstraße 1',
    address_line2: null,
    address_zip: '10115',
    address_city: 'Berlin',
    tax_number: '27/123/45678',
    vat_id: 'DE123456789',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    bank_name: 'Commerzbank',
    email: 'rechnung@e2e.example',
    phone: '+4930123456',
    registration_number: 'HRB 123456',
    registration_court: 'Amtsgericht Berlin',
    representatives: 'Max Mustermann',
  });

  const createV2Snapshot = (): InvoiceSnapshot => ({
    id: 'invoice-v2-1',
    invoice_number: 'RE-2026-0042',
    date: '2026-09-20T00:00:00.000Z',
    due_date: '2026-10-04T00:00:00.000Z',
    total_net: '250.00',
    total_tax: '50.00',
    total_gross: '300.00',
    notes: 'Bitte überweisen.',
    tax_mode: 'STANDARD',
    schema_version: 2,
    currency: 'EUR',
    seller: createV2Seller(),
    supply_date_from: '2026-09-18',
    supply_date_to: '2026-09-20',
    payment_terms: {
      days: 14,
      text: 'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
    },
    tax_breakdown: [
      { rate: '20.00', net: '250.00', tax: '50.00', gross: '300.00' },
    ],
    customer: {
      type: 'COMPANY',
      company_name: 'Kunden AG',
      first_name: 'Erika',
      last_name: 'Muster',
      email: 'erika@kunden.example',
      phone: '+43111111',
      vat_id: 'DE987654321',
      address_street: 'Kundenweg 9',
      address_city: 'München',
      address_zip: '80331',
      address_country: 'Deutschland',
    },
    vehicle: {
      make: 'BMW',
      model: '320d',
      year: 2019,
      engine_code: null,
      vin: 'WBA8E9G50JNU12345',
      plate: 'M-AB 1234',
    },
    items: [
      {
        description: 'Inspektion inkl. Ölwechsel',
        quantity: '1.250',
        unit_price: '200.00',
        tax_rate: '20.00',
        line_discount_type: 'PERCENTAGE',
        line_discount_value: '10.00',
        line_total: '270.00',
        revenue_group_name: 'Service',
      },
    ],
    snapshot_created_at: '2026-09-20T12:00:00.000Z',
  });

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

  const formatGermanDate = (val: string | Date) => {
    const date = typeof val === 'string' ? new Date(val) : val;
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  describe('isDachRechnungSnapshot', () => {
    it('returns true for schema_version 2 snapshots with seller identity', () => {
      expect(isDachRechnungSnapshot(createV2Snapshot())).toBe(true);
    });

    it('returns false for legacy v1 snapshots', () => {
      expect(isDachRechnungSnapshot(createSnapshot())).toBe(false);
    });
  });

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
      const footer = buildInvoiceFooterTemplate(
        'RE-2026-0001',
        escapeHtml,
        createSnapshot(),
      );
      expect(footer).toContain('Invoice RE-2026-0001');
      expect(footer).toContain('class="pageNumber"');
      expect(footer).toContain('class="totalPages"');
    });

    it('uses Rechnung prefix for v2 snapshots', () => {
      const footer = buildInvoiceFooterTemplate(
        'RE-2026-0042',
        escapeHtml,
        createV2Snapshot(),
      );
      expect(footer).toContain('Rechnung RE-2026-0042');
      expect(footer).not.toContain('Invoice');
    });
  });

  describe('buildInvoiceHeader', () => {
    it('renders legacy header with escaped invoice number', () => {
      const header = buildInvoiceHeader(
        'RE-2026-0001',
        escapeHtml,
        createSnapshot(),
      );
      expect(header).toContain('<h1>Invoice</h1>');
      expect(header).toContain('RE-2026-0001');
    });

    it('renders Rechnung title for v2 snapshots', () => {
      const header = buildInvoiceHeader(
        'RE-2026-0042',
        escapeHtml,
        createV2Snapshot(),
      );
      expect(header).toContain('<h1>Rechnung</h1>');
      expect(header).not.toContain('<h1>Invoice</h1>');
    });
  });

  describe('buildInvoiceSellerSection', () => {
    it('renders seller identity from snapshot for v2 invoices', () => {
      const html = buildInvoiceSellerSection(createV2Snapshot(), escapeHtml);
      expect(html).toContain('E2E GmbH');
      expect(html).toContain('Hauptstraße 1');
      expect(html).toContain('10115 Berlin');
      expect(html).toContain('USt-IdNr.: DE123456789');
      expect(html).toContain('Steuernummer: 27/123/45678');
      expect(html).toContain('IBAN: DE89370400440532013000');
    });

    it('returns empty string for legacy v1 snapshots', () => {
      expect(buildInvoiceSellerSection(createSnapshot(), escapeHtml)).toBe('');
    });
  });

  describe('buildInvoiceCustomerSection', () => {
    it('renders private customer details', () => {
      const html = buildInvoiceCustomerSection(createSnapshot(), escapeHtml);
      expect(html).toContain('Ada Lovelace');
      expect(html).toContain('Teststraße 1');
      expect(html).toContain('1010 Wien');
      expect(html).toContain('Bill to:');
    });

    it('renders company name for COMPANY type customer', () => {
      const snapshot = createSnapshot();
      snapshot.customer.type = 'COMPANY';
      snapshot.customer.company_name = 'Ada Corp';
      const html = buildInvoiceCustomerSection(snapshot, escapeHtml);
      expect(html).toContain('Ada Corp');
    });

    it('uses German recipient label for v2 snapshots', () => {
      const html = buildInvoiceCustomerSection(createV2Snapshot(), escapeHtml);
      expect(html).toContain('Rechnungsempfänger');
      expect(html).toContain('Kunden AG');
      expect(html).toContain('USt-IdNr.: DE987654321');
      expect(html).not.toContain('Bill to:');
    });

    it('uses UID for AT v2 customer VAT labels', () => {
      const snapshot = createV2Snapshot();
      snapshot.seller = {
        ...snapshot.seller!,
        country_iso: 'AT',
        vat_id: 'ATU12345678',
      };
      snapshot.customer.vat_id = 'ATU98765432';

      const html = buildInvoiceCustomerSection(snapshot, escapeHtml);
      expect(html).toContain('UID: ATU98765432');
      expect(html).not.toContain('USt-IdNr.');
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

    it('renders German metadata, supply period and payment terms for v2', () => {
      const html = buildInvoiceMetaSection(
        createV2Snapshot(),
        'RE-2026-0042',
        escapeHtml,
        formatGermanDate,
      );
      expect(html).toContain('Rechnungsnummer:');
      expect(html).toContain('Rechnungsdatum:');
      expect(html).toContain('Fällig am:');
      expect(html).toContain('Leistungszeitraum:');
      expect(html).toContain('18.09.2026');
      expect(html).toContain('20.09.2026');
      expect(html).toContain('Zahlungsbedingungen:');
      expect(html).toContain('Zahlbar innerhalb von 14 Tagen ohne Abzug.');
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

    it('uses German vehicle labels for v2 snapshots', () => {
      const html = buildInvoiceVehicleSection(createV2Snapshot(), escapeHtml);
      expect(html).toContain('Fahrzeug');
      expect(html).toContain('Kennzeichen');
      expect(html).toContain('FIN');
    });
  });

  describe('buildInvoiceItemsTable', () => {
    it('renders item row details', () => {
      const html = buildInvoiceItemsTable(createSnapshot(), escapeHtml);
      expect(html).toContain('Oil change service');
      expect(html).toContain('100.00');
    });

    it('uses German table headers and line discount for v2 snapshots', () => {
      const html = buildInvoiceItemsTable(createV2Snapshot(), escapeHtml);
      expect(html).toContain('Beschreibung');
      expect(html).toContain('Menge');
      expect(html).toContain('Einzelpreis');
      expect(html).toContain('Gesamt');
      expect(html).toContain('Inspektion inkl. Ölwechsel');
      expect(html).toContain('Rabatt 10%');
      expect(html).not.toContain('revenue_group_name');
      expect(html).not.toContain('8400');
    });

    it('does not add German discount copy to legacy v1 snapshots', () => {
      const snapshot = createSnapshot();
      snapshot.items[0].line_discount_type = 'PERCENTAGE';
      snapshot.items[0].line_discount_value = '10.00';

      const html = buildInvoiceItemsTable(snapshot, escapeHtml);
      expect(html).toContain('Oil change service');
      expect(html).not.toContain('Rabatt');
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

    it('renders German totals with per-rate VAT buckets for v2 standard invoices', () => {
      const html = buildInvoiceTotalsSection(createV2Snapshot(), escapeHtml);
      expect(html).toContain('Umsatzsteuer-Aufschlüsselung');
      expect(html).toContain('20.00 % USt');
      expect(html).toContain('Netto 250.00');
      expect(html).toContain('Netto:');
      expect(html).toContain('Umsatzsteuer:');
      expect(html).toContain('Brutto:');
      expect(html).toContain('300.00');
      expect(html).not.toContain('cost_basis');
      expect(html).not.toContain('margin_tax');
    });

    it('renders multiple VAT rate buckets for multi-rate v2 invoices', () => {
      const snapshot = createV2Snapshot();
      snapshot.tax_breakdown = [
        { rate: '20.00', net: '200.00', tax: '40.00', gross: '240.00' },
        { rate: '19.00', net: '100.00', tax: '19.00', gross: '119.00' },
      ];
      snapshot.total_net = '300.00';
      snapshot.total_tax = '59.00';
      snapshot.total_gross = '359.00';

      const html = buildInvoiceTotalsSection(snapshot, escapeHtml);
      expect(html).toContain('20.00 % USt');
      expect(html).toContain('19.00 % USt');
      expect(html).toContain('Netto 200.00');
      expect(html).toContain('Netto 100.00');
      expect(html).toContain('359.00');
    });

    it('renders margin scheme legal notice when tax_mode is MARGIN_SCHEME', () => {
      const snapshot = createSnapshot();
      snapshot.tax_mode = 'MARGIN_SCHEME';
      const html = buildInvoiceTotalsSection(snapshot, escapeHtml);
      expect(html).toContain('Differenzbesteuerung gemäß § 24 UStG');
      expect(html).not.toContain('Net:');
      expect(html).not.toContain('Umsatzsteuer-Aufschlüsselung');
    });

    it('renders only gross total and country margin note for v2 margin invoices', () => {
      const snapshot = createV2Snapshot();
      snapshot.tax_mode = 'MARGIN_SCHEME';
      snapshot.tax_breakdown = [];
      snapshot.total_net = '0.00';
      snapshot.total_tax = '0.00';
      snapshot.total_gross = '15000.00';

      const html = buildInvoiceTotalsSection(snapshot, escapeHtml);
      expect(html).toContain('Brutto:');
      expect(html).toContain('15000.00');
      expect(html).toContain('Differenzbesteuerung gemäß § 24 UStG');
      expect(html).not.toContain('Umsatzsteuer-Aufschlüsselung');
      expect(html).not.toContain('Netto:');
      expect(html).not.toContain('Umsatzsteuer:');
      expect(html).not.toContain('cost_basis');
      expect(html).not.toContain('margin_tax');
    });

    it('uses Austrian margin wording for AT v2 margin invoices', () => {
      const snapshot = createV2Snapshot();
      snapshot.tax_mode = 'MARGIN_SCHEME';
      snapshot.seller = {
        ...snapshot.seller!,
        country_iso: 'AT',
      };

      const html = buildInvoiceTotalsSection(snapshot, escapeHtml);
      expect(html).toContain('§ 24 UStG 1994');
      expect(html).not.toContain('margin_tax');
      expect(html).not.toContain('cost_basis');
    });
  });

  describe('buildInvoiceTaxBreakdownSection', () => {
    it('returns empty string when tax_breakdown is absent', () => {
      const snapshot = createSnapshot();
      expect(buildInvoiceTaxBreakdownSection(snapshot, escapeHtml)).toBe('');
    });

    it('returns empty string for margin-scheme invoices', () => {
      const snapshot = createV2Snapshot();
      snapshot.tax_mode = 'MARGIN_SCHEME';
      expect(buildInvoiceTaxBreakdownSection(snapshot, escapeHtml)).toBe('');
    });

    it('renders per-rate buckets for v2 standard invoices', () => {
      const html = buildInvoiceTaxBreakdownSection(createV2Snapshot(), escapeHtml);
      expect(html).toContain('Umsatzsteuer-Aufschlüsselung');
      expect(html).toContain('20.00 % USt');
      expect(html).toContain('Netto 250.00');
      expect(html).toContain('50.00');
    });
  });

  describe('resolveMarginSchemeLegalNote', () => {
    it('returns German wording for DE sellers', () => {
      expect(resolveMarginSchemeLegalNote('DE')).toContain('§ 24 UStG');
    });

    it('returns Austrian wording for AT sellers', () => {
      expect(resolveMarginSchemeLegalNote('AT')).toContain('§ 24 UStG 1994');
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

    it('uses German notes label for v2 snapshots', () => {
      const html = buildInvoiceNotesSection(createV2Snapshot(), escapeHtml);
      expect(html).toContain('Anmerkungen');
      expect(html).toContain('Bitte überweisen.');
    });
  });

  describe('buildInvoiceHtmlDocument', () => {
    it('assembles complete legacy invoice HTML document', () => {
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

    it('keeps v1 customer and meta in the same header flex row', () => {
      const html = buildInvoiceHtmlDocument(
        createSnapshot(),
        'RE-2026-0001',
        escapeHtml,
        formatDate,
      );

      expect(html).toMatch(
        /display: flex; justify-content: space-between;[\s\S]*Bill to:[\s\S]*Invoice Number:/,
      );
      expect(html).not.toContain('Rechnungsempfänger');
    });

    it('assembles DACH Rechnung document from v2 snapshot without internal fields', () => {
      const html = buildInvoiceHtmlDocument(
        createV2Snapshot(),
        'RE-2026-0042',
        escapeHtml,
        formatGermanDate,
      );
      expect(html).toContain('<h1>Rechnung</h1>');
      expect(html).toContain('E2E GmbH');
      expect(html).toContain('Kunden AG');
      expect(html).toContain('Zahlungsbedingungen:');
      expect(html).not.toContain('accounting_allocation');
      expect(html).not.toContain('cost_basis');
      expect(html).not.toContain('Service');
    });

    it('keeps multi-page table header group for long item lists', () => {
      const snapshot = createV2Snapshot();
      snapshot.items = Array.from({ length: 40 }, (_, index) => ({
        description: `Position ${index + 1}`,
        quantity: '1.000',
        unit_price: '10.00',
        tax_rate: '20.00',
        line_discount_type: null,
        line_discount_value: null,
        line_total: '12.00',
        revenue_group_name: 'Internal Group',
      }));

      const html = buildInvoiceHtmlDocument(
        snapshot,
        'RE-2026-0099',
        escapeHtml,
        formatGermanDate,
      );

      expect(html).toContain('display: table-header-group');
      expect(html).toContain('Position 40');
      expect(html).not.toContain('Internal Group');
    });
  });
});
